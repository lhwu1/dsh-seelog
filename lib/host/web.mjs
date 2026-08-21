import z from "@deepseek-ai/schemastery";
import { SessionId } from "@deepseek-ai/dsh-session";
//#region src/host/web.ts
/** Validated deployment limits for the snapshot endpoint. */
const Config = z.object({
	maxSessions: z.natural().min(1).max(512).default(128),
	maxEventsPerSession: z.natural().min(100).max(2e4).default(2e4)
});
/** Stable Cordis plugin name. */
const name = "dsh-seelog-web";
/** Services required to read durable events and publish the local web route. */
const inject = ["webServer", "sessionQuery"];
function stringField(value, key) {
	if (typeof value !== "object" || value === null) return void 0;
	const candidate = value[key];
	return typeof candidate === "string" && candidate !== "" ? candidate : void 0;
}
function labelForSession(events, fallback) {
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index];
		if (event?.type === "session/title") return stringField(event.data, "title") ?? fallback;
	}
	return fallback;
}
function eventNodeId(sessionId, seq) {
	return `${sessionId}:${String(seq)}`;
}
function nodeFor(event, sessionId, node) {
	return {
		id: eventNodeId(sessionId, event.seq),
		sessionId,
		seq: event.seq,
		time: event.time,
		...node
	};
}
function projectEvents(sessionId, events, maximum) {
	const omittedEvents = Math.max(0, events.length - maximum);
	const tail = events.slice(omittedEvents);
	const nodes = [];
	const calls = /* @__PURE__ */ new Map();
	for (const event of tail) switch (event.type) {
		case "turn/start":
			nodes.push(nodeFor(event, sessionId, {
				kind: "turn",
				title: `Turn ${String(event.data.turn)}`,
				status: "completed",
				turn: event.data.turn
			}));
			break;
		case "user/message":
			nodes.push(nodeFor(event, sessionId, {
				kind: "input",
				title: event.data.source.kind === "user" ? "User input" : "Injected context",
				status: "completed"
			}));
			break;
		case "assistant/message":
			nodes.push(nodeFor(event, sessionId, {
				kind: "model",
				title: "Model response",
				status: "completed",
				turn: event.data.turn,
				step: event.data.step
			}));
			break;
		case "tool/call": {
			const callId = String(event.data.callId);
			const node = nodeFor(event, sessionId, {
				kind: "tool",
				title: event.data.name,
				status: "running",
				turn: event.data.turn,
				step: event.data.step,
				callId
			});
			calls.set(callId, node);
			nodes.push(node);
			break;
		}
		case "tool/result": {
			const callId = String(event.data.message.source.callId);
			const prior = calls.get(callId);
			const error = event.data.error !== void 0;
			if (prior !== void 0) {
				prior.endTime = event.time;
				prior.status = error ? "error" : "completed";
				prior.kind = error ? "error" : "tool";
				prior.detail = error ? event.data.error?.code ?? "Tool returned an error" : void 0;
				break;
			}
			nodes.push(nodeFor(event, sessionId, {
				kind: error ? "error" : "tool",
				title: "Tool result",
				status: error ? "error" : "completed",
				callId,
				detail: error ? event.data.error?.code ?? "Tool returned an error" : void 0
			}));
			break;
		}
		case "turn/end": if (event.data.reason.kind === "error") nodes.push(nodeFor(event, sessionId, {
			kind: "error",
			title: "Turn failed",
			status: "error",
			turn: event.data.turn,
			detail: event.data.reason.error.code
		}));
	}
	return {
		nodes,
		omittedEvents
	};
}
function descendantIds(nodes) {
	const ids = [];
	const pending = [...nodes];
	for (const node of pending) {
		ids.push(String(node.session.header.id));
		pending.push(...node.descendants);
	}
	return ids;
}
async function snapshot(ctx, sessionId, config) {
	const rootId = SessionId(sessionId);
	const lineage = await ctx.sessionQuery.traceSession(rootId);
	const ids = [String(lineage.target.header.id), ...descendantIds(lineage.descendants)];
	const selected = ids.slice(0, config.maxSessions);
	const sessions = await Promise.all(selected.map(async (id) => {
		const log = await ctx.sessionQuery.readSession(SessionId(id));
		const projected = projectEvents(id, log.events.slice(log.session.seedLength ?? 0), config.maxEventsPerSession);
		return {
			id,
			...log.session.parentSession === void 0 ? {} : { parentId: String(log.session.parentSession) },
			title: labelForSession(log.events, id.slice(0, 12)),
			createdAt: log.session.createdAt,
			seedLength: log.session.seedLength ?? 0,
			sourceEventCount: log.events.length,
			capturedThroughSeq: log.events.at(-1)?.seq ?? null,
			...projected
		};
	}));
	return {
		version: 1,
		capturedAt: Date.now(),
		rootSessionId: String(lineage.target.header.id),
		sessions,
		truncated: selected.length !== ids.length
	};
}
function requestSessionId(request) {
	const sessionId = new URL(request.url ?? "/", "http://dsh.internal").searchParams.get("sessionId");
	return sessionId === null || sessionId.length === 0 || sessionId.length > 512 ? void 0 : sessionId;
}
function requestEventLocation(request) {
	const url = new URL(request.url ?? "/", "http://dsh.internal");
	const sessionId = url.searchParams.get("sessionId");
	const sequence = url.searchParams.get("seq");
	if (sessionId === null || sessionId.length === 0 || sessionId.length > 512 || sequence === null) return void 0;
	const seq = Number(sequence);
	return Number.isSafeInteger(seq) && seq >= 0 ? {
		sessionId,
		seq
	} : void 0;
}
function sendJson(response, status, value) {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	response.end(JSON.stringify(value));
}
/** Mount the same-origin endpoint serving a frozen topology-aware log projection. */
function apply(ctx, config) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-seelog/snapshot",
		async handler(request, response) {
			if (request.method !== "GET") {
				response.writeHead(405, { allow: "GET" });
				response.end();
				return;
			}
			const sessionId = requestSessionId(request);
			if (sessionId === void 0) {
				sendJson(response, 400, { error: "sessionId is required." });
				return;
			}
			try {
				sendJson(response, 200, await snapshot(ctx, sessionId, config));
			} catch (error) {
				sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}), "dsh-seelog: snapshot endpoint");
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-seelog/event",
		async handler(request, response) {
			if (request.method !== "GET") {
				response.writeHead(405, { allow: "GET" });
				response.end();
				return;
			}
			const location = requestEventLocation(request);
			if (location === void 0) {
				sendJson(response, 400, { error: "sessionId and a non-negative seq are required." });
				return;
			}
			try {
				const event = await ctx.sessionQuery.readEvent({
					sessionId: SessionId(location.sessionId),
					seq: location.seq,
					before: 2,
					after: 2
				});
				sendJson(response, 200, {
					target: event.target,
					context: event.events
				});
			} catch (error) {
				sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) });
			}
		}
	}), "dsh-seelog: event endpoint");
}
//#endregion
export { Config, apply, inject, name };

//# sourceMappingURL=web.mjs.map