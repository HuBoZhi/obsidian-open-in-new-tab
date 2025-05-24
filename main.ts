import {App, Plugin, PluginManifest, TFile, WorkspaceLeaf} from "obsidian";

interface FileCachePluginSettings {
	openedFiles: Set<string>;
}

const DEFAULT_SETTINGS: FileCachePluginSettings = {
	openedFiles: new Set<string>()
}

export default class FileCachePlugin extends Plugin {
	settings: FileCachePluginSettings;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		this.settings = DEFAULT_SETTINGS;
	}

	async onload() {
		console.log("初始化【定位文章】插件设置");
		// 初始化缓存
		this.settings.openedFiles = new Set();

		// 注册文件打开监听器
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				console.log("文件打开:", file);
				if (file) {
					this.addToCache(file.path);
				}
			})
		);

		// 注册打开文件拦截器
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				console.log("拦截文件打开请求:", file);
				if (file) {
					return this.handleFileOpen(file);
				}
			})
		);

		// 注册活动叶子变化监听器
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				const file = (leaf?.view as any)?.file;
				if (file) {
					console.log("用户点击已打开文件:", file.path);
					this.handleFileClick(file);
				}
			})
		);
	}

	// 核心逻辑：处理文件打开请求
	private async handleFileOpen(file: TFile) {
		const path = file.path;

		console.log("当前缓存:", this.settings.openedFiles);
		console.log("处理文件打开请求:", path);

		if (this.settings.openedFiles.has(path)) {
			// 定位到已存在的标签页
			const existingLeaf = this.findExistingLeaf(path);
			if (existingLeaf) {
				this.app.workspace.revealLeaf(existingLeaf);
				return false; // 阻止默认打开行为
			}
		}

		this.addToCache(path);
		return true;
	}

	// 处理用户点击已打开文件的逻辑
	private handleFileClick(file: TFile) {
		const path = file.path;

		console.log("处理用户点击文件:", path);
		if (this.settings.openedFiles.has(path)) {
			const existingLeaf = this.findExistingLeaf(path);
			if (existingLeaf) {
				this.app.workspace.revealLeaf(existingLeaf);
			}
		}
	}

	// 查找已存在的标签页
	private findExistingLeaf(path: string): WorkspaceLeaf | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const file = (leaf.view as any)?.file;
			if (file?.path === path) {
				return leaf;
			}
		}
		return null;
	}

	// 添加到缓存
	private addToCache(path: string) {
		this.settings.openedFiles.add(path);
	}
}
