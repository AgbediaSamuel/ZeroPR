import * as os from "os"

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

interface Ws {
    id: string,
    role: string,
    host: string
}

export interface Session {
    id: string,
    host: string,
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

const HTTP_URL = "http://localhost:9080"
export const host = os.hostname()

export async function apiCall<T>(URL: string, method?: string, request?: any): Promise<T> {
    let response
    if (request) {
        response = await fetch(URL, {
            method: method,
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(request)
        })
    } else {
        response = await fetch(URL)
    }
    return await response.json() as T
}

export async function getPeers(): Promise<Peer[]> {
    return await apiCall<Peer[]>(HTTP_URL + "/api/peers")
}

export async function getSessions(): Promise<Session[]> {
    return await apiCall<Session[]>(HTTP_URL + "/api/sessions")
}

export async function startBroadcast(): Promise<Boolean> {
    return await apiCall(HTTP_URL + "/api/broadcast/start")
}

export async function stopBroadcast(): Promise<Boolean> {
    return await apiCall(HTTP_URL + "/api/broadcast/stop")
}

export function wsconn(targetHost: string, params: UserRequest, onReady?: () => void): WebSocket {
    const url = `ws://${targetHost}:9080/ws/session/${params.id}`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
        const token: Ws = {
            id: params.id!,
            role: params.role,
            host: host
        }
        ws.send(JSON.stringify(token))
        onReady?.()
    }
    ws.onclose = () => {}
    return ws
}

export async function createSession(filepath: string, onReady?: () => void): Promise<{session: Session, ws: WebSocket}> {
    const request: UserRequest = {
        host: host,
        role: "Host",
        filepath: filepath
    }
    const session = await apiCall<Session>(HTTP_URL + "/api/session/create", "POST", request)
    request.id = session.id
    const ws = wsconn("localhost", request, onReady)
    return { session, ws }
}

export async function sendInvite(guestHost: string, invite: SessionInvite): Promise<string> {
    return await apiCall<string>(`http://${guestHost}:9080/api/session/join`, "POST", invite)
}

export async function joinSession(session: Session, onReady?: () => void): Promise<WebSocket> {
    const request: UserRequest = {
        host: host,
        role: "Guest",
        id: session.id
    }
    // connect to the host's agent for the relay
    const ws = wsconn(session.host, request, onReady)
    return ws
}

export async function leaveSession(sessionID: string, role: string): Promise<string> {
    const request: UserRequest = {
        host: host,
        role: role,
        id: sessionID
    }
    return await apiCall<string>(HTTP_URL + "/api/session/leave", "POST", request)
}

export async function invitePeer(peer: Peer, filepath: string, onReady?: () => void): Promise<{session: Session, ws: WebSocket}> {
    const { session, ws } = await createSession(filepath, onReady)
    const invite: SessionInvite = {
        id: session.id,
        host: host,
        guest: peer.Host,
        filepath: filepath,
        created_at: session.createdat
    }
    await sendInvite(peer.Host, invite)
    return { session, ws }
}
