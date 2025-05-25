import {App, Plugin, PluginManifest, TFile, WorkspaceLeaf} from "obsidian";
import {around} from "monkey-around"


// 插件主类
export default class OpenInNewTabPlugin extends Plugin {
	sameTabOnce: boolean; // 是否仅在当前标签页打开一次
	uninstallMonkeyPatchOpenFile: (() => void) | null; // 卸载文件打开的猴子补丁
	openedFileCache: { [key: string]: WorkspaceLeaf }; // 缓存已打开的文件

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		this.sameTabOnce = false;
		this.uninstallMonkeyPatchOpenFile = null;
		// 初始化openedFileCache对象
		this.openedFileCache = {};
	}

	// 插件加载时调用
	async onload() {
		console.log("loading " + this.manifest.name + " plugin");
		this.monkeyPatchOpenFile(); // 添加文件打开的猴子补丁
		this.addMenuItem(); // 添加右键菜单项
		this.reloadCache(); // 重新加载缓存
	}

	reloadCache() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const file = (leaf.view as any)?.file;
			let tmpPath = null;
			if (file === undefined) {
				tmpPath = leaf.view.getState().file
			} else {
				tmpPath = file.path;
			}
			if (!this.openedFileCache[tmpPath]) {
				// 缓存已打开的文件
				this.openedFileCache[tmpPath] = leaf;
			}
		})
	}


	// 插件卸载时调用
	onunload() {
		this.uninstallMonkeyPatchOpenFile && this.uninstallMonkeyPatchOpenFile(); // 卸载猴子补丁
		console.log("unloading " + this.manifest.name + " plugin");
	}

	// 添加右键菜单项
	addMenuItem() {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item.setSection("open");
						item.setTitle("Open in same tab").onClick(() => {
							this.sameTabOnce = true;
							this.app.workspace.getLeaf().openFile(file);
						});
					});
				}
			})
		);
	}

	// 查找已存在的标签页
	private findExistingLeaf(path: string): WorkspaceLeaf | null {
		// 检查缓存中是否存在已打开的文件
		let existingLeaf = this.openedFileCache[path];
		if (existingLeaf) {
			return existingLeaf;
		}

		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const file = (leaf.view as any)?.file;
			let tmpPath = null;
			if (file === undefined) {
				tmpPath = leaf.view.getState().file
			} else {
				tmpPath = file.path;
			}
			if (!tmpPath) {
				continue;
			}
			if (!this.openedFileCache[tmpPath]) {
				// 缓存已打开的文件
				this.openedFileCache[tmpPath] = leaf;
			}
			if (tmpPath === path) {
				// 如果找到已打开的文件，返回该标签页
				existingLeaf = leaf;
			}
		}
		if (existingLeaf) {
			return existingLeaf;
		}

		this.app.workspace.iterateAllLeaves((leaf) => {
			const file = (leaf.view as any)?.file;
			let tmpPath = null;
			if (file === undefined) {
				tmpPath = leaf.view.getState().file
			} else {
				tmpPath = file.path;
			}
			if (!this.openedFileCache[tmpPath]) {
				// 缓存已打开的文件
				this.openedFileCache[tmpPath] = leaf;
			}
			if (tmpPath === path) {
				// 如果找到已打开的文件，返回该标签页
				existingLeaf = leaf;
			}
		})
		return existingLeaf;
	}

	// 为文件打开功能添加猴子补丁
	monkeyPatchOpenFile() {
		const pluginInstance = this;
		this.uninstallMonkeyPatchOpenFile = around(WorkspaceLeaf.prototype, {
			openFile(originalOpenFile) {
				return async function (file, openState) {
					// 执行默认打开行为的方法
					const executeDefaultBehavior = () => {
						return originalOpenFile.apply(this, [file, openState]);
					};

					// 这两行代码的作用是检查当前的 WorkspaceLeaf 是否为空，并结合 openState 的状态进行判断。
					const isEmptyLeaf = ((this.getViewState()) == null ? void 0 : this.getViewState().type) == "empty";

					// 获取 openState 的状态
					let openStateState = openState == null ? void 0 : openState.state;
					// 检查是否存在模式（mode）并且当前 WorkspaceLeaf 是否为空
					const hasMode = (openStateState == null ? 0 : openStateState.mode);
					if (hasMode && isEmptyLeaf) {
						return executeDefaultBehavior();
					}

					// 获取当前活动文件
					let activeFile = pluginInstance.app.workspace.getActiveFile();

					// 获取 openState 的 eState 和子路径（subpath）
					let openStateEState = openState == null ? void 0 : openState.eState;
					let openStateEStateSubpath = openStateEState == null ? 0 : openStateEState.subpath;
					// 如果文件路径与活动文件路径相同且存在子路径，执行默认打开行为
					if (file.path == (activeFile == null ? void 0 : activeFile.path) && openStateEStateSubpath) {
						return executeDefaultBehavior();
					}


					// 判断当前文件是否在活动列表中
					const existingLeaf = pluginInstance.findExistingLeaf(file.path);
					if (existingLeaf) {
						// 如果文件已在活动列表中，定位到当前文档
						return pluginInstance.app.workspace.revealLeaf(existingLeaf);
						// 	setActiveLeaf
					} else {
						// 在新标签页中打开文件
						// pluginInstance.app.workspace.getLeaf("tab"): 获取一个新的标签页（tab）类型的 WorkspaceLeaf，用于在新标签页中打开文件。
						// originalOpenFile.apply(...): 调用原始的 openFile 方法（被猴子补丁拦截的原始方法），并将新的标签页和文件信息作为参数传递。
						// 参数: file: 要打开的文件，openState: 打开状态信息。
						return originalOpenFile.apply(pluginInstance.app.workspace.getLeaf("tab"), [
							file,
							openState
						])
					}
				};
			}
		});
	}
}
