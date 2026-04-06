import * as os from "os";

interface UserRequest {
    host: string,
    role: string,
    id?: string,
    filepath?: string,
}

export interface Peer {
    Name: string,
    Host: string,
    LastSeen: string
}

export interface Session {
    id: string,
    host: string,
    relayHost: string,
    guest: string,
    filepath: string,
    createdat: string,
    active: string
}

export interface SessionInvite {
    id: string,
    host: string,
    guest: string,
    filepath: string,
    created_at: string
}

const HTTP_URL = "http://localhost:9080";
export const host = os.hostname();

export async function apiCall<T>(url: string, method?: string, body?: any): Promise<T> {
    const options: RequestInit = body
        ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {};
    const response = await fetch(url, options);
    return await response.json() as T;
}

export async function getPeers(): Promise<Peer[]> {
    return await apiCall<Peer[]>(HTTP_URL + "/api/peers");
}

export async function getSessions(): Promise<Session[]> {
    return await apiCall<Session[]>(HTTP_URL + "/api/sessions");
}

export async function startBroadcast(): Promise<Boolean> {
    return await apiCall(HTTP_URL + "/api/broadcast/start");
}

export async function stopBroadcast(): Promise<Boolean> {
    return await apiCall(HTTP_URL + "/api/broadcast/stop");
}

export function wsconn(targetHost: string, params: UserRequest): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const url = `ws://${targetHost}:9080/ws/session/${params.id}`;
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
            ws.send(JSON.stringify({ id: params.id!, role: params.role, host }));
            resolve(ws);
        };
        ws.onerror = () => reject(new Error(`WebSocket connection failed to ${targetHost}`));
        ws.onclose = () => {};
    });
}

export async function createSession(filepath: string): Promise<{session: Session, ws: WebSocket}> {
    const request: UserRequest = {
        host: host,
        role: "Host",
        filepath: filepath
    };
    const session = await apiCall<Session>(HTTP_URL + "/api/session/create", "POST", request);
    request.id = session.id;
    const ws = await wsconn("localhost", request);
    return { session, ws };
}

export async function sendInvite(guestHost: string, invite: SessionInvite): Promise<string> {
    return await apiCall<string>(`http://${guestHost}:9080/api/session/join`, "POST", invite);
}

export async function joinSession(session: Session): Promise<WebSocket> {
    const request: UserRequest = {
        host: host,
        role: "Guest",
        id: session.id
    };
    return await wsconn(session.relayHost, request);
}

export async function leaveSession(sessionID: string, role: string): Promise<string> {
    const request: UserRequest = {
        host: host,
        role: role,
        id: sessionID
    };
    return await apiCall<string>(HTTP_URL + "/api/session/leave", "POST", request);
}

export async function endSession(sessionID: string): Promise<string> {
    const request: UserRequest = {
        host: host,
        role: "Host",
        id: sessionID
    };
    return await apiCall<string>(HTTP_URL + "/api/session/end", "POST", request);
}

export async function invitePeer(peer: Peer, filepath: string): Promise<{session: Session, ws: WebSocket}> {
    const { session, ws } = await createSession(filepath);
    const invite: SessionInvite = {
        id: session.id,
        host: host,
        guest: peer.Host,
        filepath: filepath,
        created_at: session.createdat
    };
    await sendInvite(peer.Host, invite);
    return { session, ws };
}
