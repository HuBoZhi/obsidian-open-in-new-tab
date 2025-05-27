import {App, Notice, Plugin, PluginManifest, PluginSettingTab, Setting, TFile, WorkspaceLeaf} from "obsidian";
import {around} from "monkey-around"


// 插件设置接口定义
interface OpenInNewTabSettings {
	maxOpenFileNum: number;
}

// 默认插件设置
const DEFAULT_SETTINGS: OpenInNewTabSettings = {
	maxOpenFileNum: 15
};

// 插件主类
export default class OpenInNewTabPlugin extends Plugin {
	settings: OpenInNewTabSettings;
	sameTabOnce: boolean; // 是否仅在当前标签页打开一次
	uninstallMonkeyPatchOpenFile: (() => void) | null; // 卸载文件打开的猴子补丁
	openedFileCache: { [key: string]: WorkspaceLeaf }; // 缓存已打开的文件
	lufQueueMaxSize: number;
	lufQueue: Map<string, boolean>; // 使用 Map 保证有序性

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		this.sameTabOnce = false;
		this.uninstallMonkeyPatchOpenFile = null;
		// 初始化openedFileCache对象
		this.openedFileCache = {};
		this.lufQueueMaxSize = 200; // 队列的最大容量
		this.lufQueue = new Map(); // 使用 Map 保证有序性
	}

	// 插件加载时调用
	async onload() {
		console.log("loading " + this.manifest.name + " plugin");
		await this.loadSettings();
		this.monkeyPatchOpenFile(); // 添加文件打开的猴子补丁
		this.addMenuItem(); // 添加右键菜单项
		this.reloadCache(); // 重新加载缓存
		// 监听文件关闭事件，关闭文件时清理这个文件的缓存
		this.app.workspace.on("active-leaf-change", (leaf) => {
			this.reloadCache();
		})

		this.addSettingTab(new OpenInNewTabSettingTab(this.app, this)); // 添加设置面板
	}

	// 加载插件设置
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	// 保存插件设置
	async saveSettings() {
		await this.saveData(this.settings);
	}

	checkUn(o: any): boolean {
		// 检查任意对象数组元素不为null,undefined
		return o !== undefined && o !== null;
	}

	reloadCache() {
		this.openedFileCache = {}; // 清空缓存
		this.app.workspace.iterateAllLeaves((leaf) => {
			const file = (leaf.view as any)?.file;
			let tmpPath = null;
			if (this.checkUn(file)) {
				tmpPath = file.path;
			}

			if (tmpPath === "" || tmpPath === null || tmpPath === undefined) {
				tmpPath = leaf.view.getState().file
			}

			if (!(tmpPath === "" || tmpPath === null || tmpPath === undefined)) {
				if (!this.openedFileCache[tmpPath]) {
					// 缓存已打开的文件
					this.openedFileCache[tmpPath] = leaf;
				}
			}
		})

		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const file = (leaf.view as any)?.file;
			let tmpPath = null;
			if (this.checkUn(file)) {
				tmpPath = file.path;
			}

			if (tmpPath === "" || tmpPath === null || tmpPath === undefined) {
				tmpPath = leaf.view.getState().file
			}

			if (!(tmpPath === "" || tmpPath === null || tmpPath === undefined)) {
				if (!this.openedFileCache[tmpPath]) {
					// 缓存已打开的文件
					this.openedFileCache[tmpPath] = leaf;
				}
			}
		}
	}


	// 插件卸载时调用
	onunload() {
		this.uninstallMonkeyPatchOpenFile && this.uninstallMonkeyPatchOpenFile(); // 卸载猴子补丁
		this.openedFileCache = {}; // 清空缓存
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
			if (this.checkUn(file)) {
				tmpPath = file.path;
			}

			if (tmpPath === "" || tmpPath === null || tmpPath === undefined) {
				tmpPath = leaf.view.getState().file
			}

			if (!(tmpPath === "" || tmpPath === null || tmpPath === undefined)) {
				if (!this.openedFileCache[tmpPath]) {
					// 缓存已打开的文件
					this.openedFileCache[tmpPath] = leaf;
				}
				if (tmpPath === path) {
					// 如果找到已打开的文件，返回该标签页
					existingLeaf = leaf;
				}
			}
		}
		if (existingLeaf) {
			return existingLeaf;
		}

		this.app.workspace.iterateAllLeaves((leaf) => {
			const file = (leaf.view as any)?.file;
			let tmpPath = null;
			if (this.checkUn(file)) {
				tmpPath = file.path;
			}

			if (tmpPath === "" || tmpPath === null || tmpPath === undefined) {
				tmpPath = leaf.view.getState().file
			}

			if (!(tmpPath === "" || tmpPath === null || tmpPath === undefined)) {
				if (!this.openedFileCache[tmpPath]) {
					// 缓存已打开的文件
					this.openedFileCache[tmpPath] = leaf;
				}
				if (tmpPath === path) {
					// 如果找到已打开的文件，返回该标签页
					existingLeaf = leaf;
				}
			}
		})
		return existingLeaf;
	}

	// 存储已打开的文件路径:添加或更新文件路径
	lufCacheFilePathAdd(filePath: string) {
		let needCloseFilePath = "";
		// 如果文件路径不存在或为空，直接返回
		if (!filePath || filePath.trim() === "") {
			return;
		}
		if (this.lufQueue.has(filePath)) {
			// 如果文件路径已存在，先删除旧的
			this.lufQueue.delete(filePath);
		} else if (this.lufQueue.size >= this.lufQueueMaxSize || this.lufQueue.size > this.settings.maxOpenFileNum) {
			// 如果队列已满，移除最近最少使用的文件路径
			const leastUsedKey = this.lufQueue.keys().next().value;
			needCloseFilePath = leastUsedKey; // 记录需要关闭的文件路径
			this.lufQueue.delete(leastUsedKey);
		}
		// 将文件路径添加到队列末尾
		this.lufQueue.set(filePath, true);
		if (needCloseFilePath !== "" && this.openedFileCache[needCloseFilePath]) {
			const openedFileCacheElement = this.openedFileCache[needCloseFilePath];
			if (openedFileCacheElement) {
				// 如果需要关闭的文件路径在缓存中，关闭该标签页
				openedFileCacheElement.detach();
				delete this.openedFileCache[needCloseFilePath]; // 从缓存中删除
			}
		}
	}


	// 为文件打开功能添加猴子补丁
	monkeyPatchOpenFile() {
		// eslint-disable-next-line @typescript-eslint/no-this-alias
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
					const openStateState = openState == null ? void 0 : openState.state;
					// 检查是否存在模式（mode）并且当前 WorkspaceLeaf 是否为空
					const hasMode = (openStateState == null ? 0 : openStateState.mode);
					if (hasMode && isEmptyLeaf) {
						return executeDefaultBehavior();
					}

					// 获取当前活动文件
					const activeFile = pluginInstance.app.workspace.getActiveFile();

					// 获取 openState 的 eState 和子路径（subpath）
					const openStateEState = openState == null ? void 0 : openState.eState;
					const openStateEStateSubpath = openStateEState == null ? 0 : openStateEState.subpath;
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
						pluginInstance.lufCacheFilePathAdd(file.path);
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


// 插件设置面板类
class OpenInNewTabSettingTab extends PluginSettingTab {
	plugin: OpenInNewTabPlugin;

	constructor(app: any, plugin: OpenInNewTabPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// 显示设置面板UI
	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl('h2', {text: '扩展功能'});

		new Setting(containerEl)
			.setName('最多打开文档数')
			.setDesc('设置最多打开文档数，如果文档数量超过此值，将按照最近最少使用策略删除最旧的文档')
			.addText(text => text
				.setValue(this.plugin.settings.maxOpenFileNum.toString())
				.onChange(async (value) => {
					// 检查输入值是否为数字
					if (isNaN(parseInt(value))) {
						new Notice("请输入一个数字");
						return;
					}
					// 值不能大于100
					if (parseInt(value) > 100) {
						new Notice("最多只能打开100个文件");
						return;
					}

					this.plugin.settings.maxOpenFileNum = parseInt(value);
					await this.plugin.saveSettings();
				}));
	}
}
