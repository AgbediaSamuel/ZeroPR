"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode3 = __toESM(require("vscode"));

// src/agentClient.ts
var os = __toESM(require("os"));
var HTTP_URL = "http://localhost:9080";
var WS_URL = "ws://localhost:9080/ws/session/";
var host = os.hostname();
async function apiCall(URL, method, request) {
  let data, response;
  if (request) {
    response = await fetch(URL, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(request)
    });
    data = await response.json();
    return data;
  }
  response = await fetch(URL);
  data = await response.json();
  return data;
}
async function getPeers() {
  return await apiCall(HTTP_URL + "/api/peers");
}
async function getSessions() {
  return await apiCall(HTTP_URL + "/api/sessions");
}
async function startBroadcast() {
  return await apiCall(HTTP_URL + "/api/broadcast/start");
}
async function stopBroadcast() {
  return await apiCall(HTTP_URL + "/api/broadcast/stop");
}
function wsconn(params) {
  const ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    const token = {
      ID: params.ID,
      Role: params.Role,
      Host: host
    };
    ws.send(JSON.stringify(token));
  };
  ws.onmessage = (event) => {
    console.log(event.data);
  };
  ws.onclose = () => {
  };
}
async function createSession(host2, role) {
  const request = {
    Host: host2,
    Role: role
  };
  const session = await apiCall(HTTP_URL + "/api/session/create", "POST", request);
  request.ID = session.ID;
  wsconn(request);
  return session;
}
async function sendInvite(guestHost, invite) {
  return await apiCall(`http://${guestHost}:9080/api/session/join`, "POST", invite);
}
async function joinSession(host2, role, sessionID) {
  const request = {
    Host: host2,
    Role: role,
    ID: sessionID
  };
  const response = await apiCall(HTTP_URL + "/api/session/join", "POST", request);
  wsconn(request);
}
async function leaveSession(host2, role, sessionID) {
  const request = {
    Host: host2,
    Role: role,
    ID: sessionID
  };
  const response = await apiCall(HTTP_URL + "/api/session/leave", "POST", request);
  return response;
}
async function invitePeer(peer) {
  const session = await createSession(host, "Host");
  const invite = {
    ID: session.ID,
    Host: session.Host,
    Guest: peer.Host,
    FilePath: session.FilePath,
    CreatedAt: session.CreatedAt
  };
  await sendInvite(peer.Host, invite);
}
function test() {
  console.log(os.hostname());
}
test();

// src/peersTree.ts
var vscode = __toESM(require("vscode"));
var import_vscode = require("vscode");
var Peers = class {
  getTreeItem(element) {
    const peer = new import_vscode.TreeItem(element.Host);
    peer.tooltip = `Last Seen: ${element.LastSeen}`;
    return peer;
  }
  async getChildren() {
    const peers = await getPeers();
    return peers;
  }
  changeEvent = new vscode.EventEmitter();
  onDidChangeTreeData = this.changeEvent.event;
  update() {
    this.changeEvent.fire(void 0);
  }
};

// src/sessionsTree.ts
var vscode2 = __toESM(require("vscode"));
var import_vscode2 = require("vscode");
var Sessions = class {
  getTreeItem(element) {
    const other = element.Host === host ? element.Guest : element.Host;
    const session = new import_vscode2.TreeItem(`Session with ${other}`);
    session.description = element.ID;
    session.tooltip = `Created: ${element.CreatedAt}`;
    return session;
  }
  async getChildren() {
    const sessions = await getSessions();
    return sessions;
  }
  changeEvent = new vscode2.EventEmitter();
  onDidChangeTreeData = this.changeEvent.event;
  update() {
    this.changeEvent.fire(void 0);
  }
};

// src/extension.ts
function activate(context) {
  const peersView = new Peers();
  const sessionsView = new Sessions();
  vscode3.window.registerTreeDataProvider("zeropr.getPeers", peersView);
  vscode3.window.registerTreeDataProvider("zeropr.sessions", sessionsView);
  vscode3.commands.registerCommand("zeropr.startBroadcast", () => {
    startBroadcast();
    peersView.update();
  });
  vscode3.commands.registerCommand("zeropr.stopBroadcast", () => {
    stopBroadcast();
    peersView.update();
  });
  vscode3.commands.registerCommand("zeropr.refreshPeers", () => {
    peersView.update();
  });
  vscode3.commands.registerCommand("zeropr.invitePeer", async (peer) => {
    await invitePeer(peer);
    sessionsView.update();
  });
  vscode3.commands.registerCommand("zeropr.createSession", createSession);
  vscode3.commands.registerCommand("zeropr.joinSession", joinSession);
  vscode3.commands.registerCommand("zeropr.leaveSession", leaveSession);
  console.log('Congratulations, your extension "zeropr" is now active!');
  const disposable = vscode3.commands.registerCommand("zeropr.helloWorld", () => {
    vscode3.window.showInformationMessage("Hello World from zeropr!");
  });
  context.subscriptions.push(disposable);
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
