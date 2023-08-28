import {
  commands,
  Event,
  EventEmitter,
  ExtensionContext,
  OutputChannel,
  QuickPickItem,
  RemoteAuthorityResolverError,
  ResolvedAuthority,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  window,
  workspace,
} from "vscode";
import { HostConfig, HostKind } from "./remotesConfig";

export class HostBase extends TreeItem {
  name: string;
  folders: FolderItem[];

  constructor(label: string) {
    super(label, TreeItemCollapsibleState.None);
    this.name = label;
    this.folders = [];
  }

  addFolder(folder: FolderItem) {
    this.folders.push(folder);
    this.collapsibleState = TreeItemCollapsibleState.Expanded;
  }
}

export class FolderItem extends TreeItem {
  readonly host: string;
  readonly path: string;
  constructor(label: string, host: string, path: string) {
    super(label, TreeItemCollapsibleState.None);
    this.contextValue = "remote-oss.folder";
    this.iconPath = ThemeIcon.Folder;
    this.host = host;
    this.path = path;
  }
}

export class PlainHostItem extends HostBase {
  constructor(
    label: string,
    public readonly host: string,
    public readonly port: number,
    public readonly connectionToken: string | boolean
  ) {
    super(label);
    this.contextValue = "remote-oss.host";
    this.iconPath = new ThemeIcon("device-desktop");
    this.description = `${host}:${port}`;
  }
}

export class ScriptHostItem extends HostBase {
  constructor(
    label: string,
    public readonly host: string,
    public readonly port: number,
    public readonly connectionToken: string | boolean,
    public readonly localDirectory: string,
    public readonly listenScript: string,
    public readonly listenScriptReady: string | undefined
  ) {
    super(label);
    this.contextValue = "remote-oss.host";
    this.iconPath = new ThemeIcon("device-desktop");
    this.description = `${host}:${port}`;
  }
}

export type Host = PlainHostItem | ScriptHostItem;

class KindItem extends TreeItem {
  hosts: Host[] = [];

  constructor(label: string, description?: string) {
    super(label, TreeItemCollapsibleState.Expanded);
    this.contextValue = "remote-oss.kind";
    this.iconPath = ThemeIcon.Folder;
    this.description = description;
  }

  addHost(host: Host) {
    this.hosts.push(host);
  }
}

type TaskTree = KindItem[] | Host[];

export class RemotesDataProvider implements TreeDataProvider<TreeItem> {
  private remotesTree: TaskTree | null = null;
  private extensionContext: ExtensionContext;
  private _onDidChangeTreeData: EventEmitter<TreeItem | null> =
    new EventEmitter<TreeItem | null>();
  readonly onDidChangeTreeData: Event<TreeItem | null> =
    this._onDidChangeTreeData.event;

  constructor(private context: ExtensionContext) {
    const subscriptions = context.subscriptions;
    this.extensionContext = context;
  }

  getTreeItem(element: TreeItem): TreeItem {
    return element;
  }

  getParent(element: TreeItem): TreeItem | null {
    return null;
  }

  async setNoHostsContext(enabled: boolean) {
    await commands.executeCommand("setContext", "remote-oss:noHosts", enabled);
  }

  async readTree() {
    let tree = [];

    var numberOfHosts = 0;
    const value: any = workspace.getConfiguration().get("remote.OSS.hosts");
    if (value) {
      let manual = new KindItem("manual");
      const hosts: HostConfig[] = value;
      for (const host of hosts) {
        if (host.type === HostKind.Manual) {
          var connectionToken = host.connectionToken;
          if (!connectionToken && typeof connectionToken !== "boolean") {
            connectionToken = true;
          }

          const hostItem = new PlainHostItem(
            host.name,
            host.host,
            host.port,
            connectionToken
          );
          manual.addHost(hostItem);
          numberOfHosts += 1;
          if (host.folders) {
            for (const folder of host.folders) {
              const hostName = hostItem.label;
              if (typeof hostName !== "string") {
                continue;
              }
              if (typeof folder === "string") {
                hostItem.addFolder(new FolderItem(folder, hostName, folder));
              } else {
                hostItem.addFolder(
                  new FolderItem(folder.name, hostName, folder.path)
                );
              }
            }
          }
        } else if (host.type === HostKind.Script) {
          var connectionToken = host.connectionToken;
          if (!connectionToken && typeof connectionToken !== "boolean") {
            connectionToken = true;
          }

          const hostItem = new ScriptHostItem(
            host.name,
            host.host,
            host.port,
            connectionToken,
            host.localDirectory,
            host.listenScript,
            host.listenScriptReady
          );
          manual.addHost(hostItem);
          numberOfHosts += 1;
          if (host.folders) {
            for (const folder of host.folders) {
              const hostName = hostItem.label;
              if (typeof hostName !== "string") {
                continue;
              }
              if (typeof folder === "string") {
                hostItem.addFolder(new FolderItem(folder, hostName, folder));
              } else {
                hostItem.addFolder(
                  new FolderItem(folder.name, hostName, folder.path)
                );
              }
            }
          }
        }
      }
      if (manual.hosts.length > 0) {
        tree.push(manual);
      }
    }

    await this.setNoHostsContext(numberOfHosts === 0);

    this.remotesTree = tree;
    this._onDidChangeTreeData.fire(null);
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!this.remotesTree) {
      await this.readTree();
    }
    if (element instanceof HostBase) {
      return element.folders;
    }
    if (element instanceof KindItem) {
      return element.hosts;
    }
    if (!element) {
      if (this.remotesTree) {
        return this.remotesTree;
      }
    }
    return [];
  }

  async _getHostList(out: Host[], root: TreeItem[]) {
    for (let entry of root) {
      if (entry instanceof PlainHostItem || entry instanceof ScriptHostItem) {
        out.push(entry);
      } else {
        await this._getHostList(out, await this.getChildren(entry));
      }
    }
  }

  async getHostList(): Promise<Host[]> {
    let out: Host[] = [];
    await this._getHostList(out, await this.getChildren());
    return out;
  }

  async pickHost(): Promise<string | undefined> {
    const quickpick = window.createQuickPick();
    quickpick.canSelectMany = false;
    quickpick.show();

    try {
      quickpick.busy = true;

      quickpick.items = (await this.getHostList()).map((h) => ({
        label: `${h.label}`,
      }));
      quickpick.busy = false;

      const result = await Promise.race([
        new Promise<readonly QuickPickItem[]>((c) =>
          quickpick.onDidAccept(() => c(quickpick.selectedItems))
        ),
        new Promise<undefined>((c) => quickpick.onDidHide(() => c(undefined))),
      ]);

      if (!result || result.length === 0) {
        return;
      }

      let host = result[0].label;
      return `remote-oss+${host}`;
    } finally {
      quickpick.dispose();
    }
    return;
  }

  async getHost(label: string): Promise<Host> {
    const hosts = (await this.getHostList()).filter((h) => h.label === label);
    if (!hosts || hosts.length === 0) {
      throw RemoteAuthorityResolverError.NotAvailable(
        `Host ${label} is not available.`,
        true
      );
    }
    return hosts[0];
  }
}
