import * as os from "os"

interface UserRequest {
    Host: string,
    Role: string,
    ID?: string,
    FilePath?: string,
}

export interface Peer {
    Name: string,
    Host: string,
    LastSeen: string
}

interface Ws {
    ID: string,
    Role: string,
    Host: string
}

export interface Session {
    ID: string,
    Host: string,
    Guest: string,
    FilePath: string,
    CreatedAt: string,
    Active: string
}

export interface SessionInvite {
    ID: string,
    Host: string,
    Guest: string,
    FilePath: string,
    CreatedAt: string
}

// maybe write a reusable function for sending different types of responses to the 
// backend
// maybe the if block for apicall can be simplified later on lol
// add generics to every call and do something with the http responses

const HTTP_URL = "http://localhost:9080"
const WS_URL = "ws://localhost:9080/ws/session/"
export const host = os.hostname()

export async function apiCall<T>(URL: string, method?:string, request?: any): Promise<T> {
    let data, response
    if (request) {
        response = await fetch(URL, {
            method: method,
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(request)
        })
        data = await response.json() as T
        return data
    } 
    response = await fetch(URL)
    data = await response.json() as T
    return data
    
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

export function wsconn(params: UserRequest) {

    const ws = new WebSocket(WS_URL)
    ws.onopen = () => {
        const token: Ws = {
            ID: params.ID!,
            Role: params.Role,
            Host: host
        }
        ws.send(JSON.stringify(token))
    }

    ws.onmessage = (event) => {
        console.log(event.data)
        // just print for now
    }

    ws.onclose = () => {
        
    }
}

export async function createSession(host: string, role: string): Promise<Session> {
    const request: UserRequest = {
        Host: host,
        Role: role
    }
    const session = await apiCall<Session>(HTTP_URL + "/api/session/create", "POST", request)
    request.ID = session.ID
    wsconn(request)
    return session
}

export async function sendInvite(guestHost: string, invite: SessionInvite): Promise<string> {
    return await apiCall<string>(`http://${guestHost}:9080/api/session/join`, "POST", invite)
}

export async function joinSession(host:string, role:string, sessionID: string) {
    const request: UserRequest = {
        Host: host,
        Role: role,
        ID: sessionID
    }
    const response = await apiCall<string>(HTTP_URL + "/api/session/join", "POST", request)
    wsconn(request)
}

export async function leaveSession(host:string, role:string, sessionID:string): Promise<string> {
    const request: UserRequest = {
        Host: host,
        Role: role,
        ID: sessionID
    }

    const response = await apiCall<string>(HTTP_URL + "/api/session/leave", "POST", request)
    return response
}

export async function invitePeer(peer: Peer) {
    const session = await createSession(host, "Host")
    const invite: SessionInvite = {
        ID: session.ID,
        Host: session.Host,
        Guest: peer.Host,
        FilePath: session.FilePath,
        CreatedAt: session.CreatedAt
    }
    await sendInvite(peer.Host, invite)
}

export function test() {
    console.log(os.hostname())
}

test()
