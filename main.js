const {
  Plugin,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  FileSystemAdapter,
  MarkdownView,
} = require("obsidian");
const https = require("https");
const path = require("path");

class ImageDownloaderSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl("h2", { text: "Image Downloader Settings" });

    new Setting(containerEl)
      .setName("Image Save Directory")
      .setDesc(
        "Image save directory is the same as Obsidian's attachment default directory, no need to extra configure"
      );
    // .addText((text) =>
    //   text
    //     .setPlaceholder(DefaultConfig.assetsDir)
    //     .setValue(this.plugin.settings.assetsDir)
    //     .onChange(async (value) => {
    //       this.plugin.settings.assetsDir = value;
    //       await this.plugin.saveSettings();
    //     })
    // );
  }
}

class DefaultConfig {
  static assetsDir = "assets";
  static obsmediadir = "";
}

class RefererModal extends Modal {
  defaultReferer = "";
  constructor(app, callback) {
    super(app);
    this.callback = callback;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty(); // 清空内容
    const label = contentEl.createEl("label", {
      text: "Please input Referer (URL):",
    });
    contentEl.createEl("br");
    const input = contentEl.createEl("input", {
      type: "text",
      id: "referer-input",
      placeholder: "https://example.com/xxx/",
    });
    input.style.margin = "10px";
    input.style.marginLeft = "5px";
    input.style.width = "80%";
    if (this.defaultReferer) {
      input.value = this.defaultReferer; // 设置默认Referer
    }

    const confirmButton = contentEl.createEl("button", { text: "OK" });
    confirmButton.addEventListener("click", () => {
      const referer = input.value;
      if (!referer) {
        alert("Referer cannot be empty!");
        return;
      }
      this.callback(referer);
      this.close();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        confirmButton.click();
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

module.exports = class ImageDownloaderPlugin extends Plugin {
  async onload() {
    await this.loadSettings(); // Ensure settings are loaded

    this.addCommand({
      id: "download-images",
      name: "Download images with referer",
      callback: () => this.downloadImages(),
    });

    this.addSettingTab(new ImageDownloaderSettingTab(this.app, this));
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({ assetsDir: DefaultConfig.assetsDir }, data); // 设置默认值
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async downloadWithReferer(referer) {
    let downloadDir = "";
    if (DefaultConfig.obsmediadir.startsWith(".")) {
      //当前文件所在文件夹(./) + 当前文件所在文件夹下的子文件夹(./assets)
      downloadDir = path.join(
        path.dirname(this.app.workspace.getActiveFile().path),
        DefaultConfig.obsmediadir
      );
    } else {
      // 仓库根目录(/) + 指定的附件文件夹(attachment)
      downloadDir = DefaultConfig.obsmediadir;
    }
    const imageUrls = this.extractImageUrls(this.content);
    const downloadedPathsMap = new Map(); // 用于存储下载的文件路径
    // 检查并创建目录
    try {
      await FileSystemAdapter.mkdir(
        path.join(this.app.vault.adapter.basePath, downloadDir),
        {
          recursive: true,
        }
      );
      console.debug(
        "Download to ",
        path.join(this.app.vault.adapter.basePath, downloadDir)
      );
    } catch (err) {
      console.error("Directory creation failed:", err);
      new Notice("Directory creation failed, please check permissions!");
      return;
    }

    for (const url of imageUrls) {
      try {
        const fileName = await this.downloadImage(url, downloadDir, referer);
        downloadedPathsMap.set(
          url,
          path.join(DefaultConfig.obsmediadir, fileName).replaceAll("\\", "/")
        ); // 收集下载的文件路径, 反斜杠替换成斜杠是因为obsidian在markdown中不支持反斜杠
      } catch (error) {
        console.error(
          `Download failed: ${url}, error message: ${error.message}`
        );
        new Notice(
          "Can not download some images. You can retry it, or press Ctrl+Shift+I to view the error log"
        );
      }
    }

    const updatedContent = this.replaceImageUrls(
      this.content,
      downloadedPathsMap
    );
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.editor.hasFocus()) {   // 编辑器打开的情况下不要直接修改文件，否则输入Referer后按回车确认时，会导致文档开头多一个回车
      view.editor.setValue(updatedContent);
    } else {
      await this.app.vault.modify(this.activeFile, updatedContent);
    }
    new Notice("Images download completed!");
  }

  async downloadImages() {
    DefaultConfig.obsmediadir = this.app.vault.getConfig(
      "attachmentFolderPath"
    );
    console.debug("obsmediadir: ", DefaultConfig.obsmediadir);

    this.activeFile = this.app.workspace.getActiveFile();
    if (!this.activeFile) {
      new Notice("You haven't open a document!");
      return;
    }
    let disableModal = false;
    let defaultReferer = "";
    // 优先从文档属性中获取Referer
    this.app.fileManager.processFrontMatter(this.activeFile, (frontmatter) => {
      for (const key in frontmatter) {
        if (
          typeof frontmatter[key] === "string" &&
          frontmatter[key].toLowerCase().startsWith("http")
        ) {
          console.debug(
            `Found Referer from properties of document. ${key}: ${frontmatter[key]}`
          );
          defaultReferer = frontmatter[key];
          disableModal = true;
        }
      }
    });

    const activeAbsolutePath = `${this.app.vault.adapter.basePath}/${this.activeFile.path}`;
    console.debug("Current active file path: ", activeAbsolutePath);

    this.content = await this.app.vault.read(this.activeFile);

    if (defaultReferer === "") {
      // 如果文档属性中没有Referer，查找文档前200个字符中的第一个URL
      const first200Chars = this.content.slice(0, 200);
      const urlMatch = first200Chars.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        defaultReferer = urlMatch[0];
        console.debug("Found Referer from file content.", urlMatch[0]);
      }
    }

    if (!disableModal) {
      const modal = new RefererModal(app, async (referer) => {
        await this.downloadWithReferer(referer);
      });
      // 在弹框中填充默认Referer
      modal.defaultReferer = defaultReferer;
      modal.open();
    } else this.downloadWithReferer(defaultReferer);
  }

  replaceImageUrls(content, downloadedPaths) {
    return content.replace(/!\[(.*?)\]\((http.*?)\)/g, (match, ...p) => {
      console.debug("match: ", match);
      console.debug("p: ", p);
      const downloadedPath = downloadedPaths.get(p[1]); // 从 Map 中获取下载路径
      if (!downloadedPath) return match; // 如果没有下载该URL，则返回原始内容
      return `![${p[0]}](${downloadedPath})`; // 使用下载的路径
    });
  }

  extractImageUrls(content) {
    const regex = /!\[.*?\]\((http.*?)\)/g;
    const urls = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      urls.push(match[1]);
    }
    return urls;
  }

  async downloadImage(url, dirPath, referer) {
    console.debug("Start downloading image:", url);
    let options = {};
    if (referer) {
      options = {
        headers: {
          Referer: encodeURI(referer),
        },
        // rejectUnauthorized: false    //默认情况下不信任安装在“受信任的根证书颁发机构”中的自签名证书，调试时需禁用https证书校验，否则抓包时会出现“self signed certificate in certificate chain”错误
      };
    }

    return new Promise((resolve, reject) => {
      https
        .get(url, options, async (response) => {
          let data = [];
          const contentType = response.headers["content-type"];
          let extension = "";

          // 根据 Content-Type 确定文件扩展名
          const typeMap = {
            jpeg: ".jpg",
            jpg: ".jpg",
            png: ".png",
            gif: ".gif",
            webp: ".webp",
            "svg+xml": ".svg",
            tiff: ".tiff",
            bmp: ".bmp",
            ico: ".ico",
            avif: ".avif",
            heic: ".heic",
            heif: ".heif",
          };
          const type = contentType.split("/")[1];
          if (contentType.split("/")[0] === "text") {
            new Notice(
              "Remote resource is not image, please check your Referer."
            );
          }
          if (typeMap[type]) {
            extension = typeMap[type];
          } else {
            console.error(
              "Unsupported file type:",
              contentType,
              "for URL:",
              url
            );
            reject(new Error("Unsupported file type: " + contentType));
            new Notice("Unsupported file type: " + contentType);
            return;
          }

          response.on("data", (chunk) => {
            data.push(chunk);
          });

          response.on("end", async () => {
            const buffer = Buffer.concat(data);
            console.debug(`Image file size: ${buffer.length} bytes`);

            if (extension !== ".svg" && buffer.length < 1024) {
              console.error(
                "The image size is too small, it seems that downloaded content is not a image."
              );
            }
            // 生成随机文件名
            let filePath;
            let fileName;
            // const fileSystemAdapter = this.vault.adapter
            do {
              const timestamp = Math.floor(Date.now() / 1000);
              const chars = "abcdefghijklmnopqrstuvwxyz0123456789".split("");
              const randomStr = Array(5)
                .fill(0)
                .map(() => chars[Math.floor(Math.random() * chars.length)])
                .join("");
              fileName = `${timestamp}_${randomStr}${extension}`;
              filePath = `${dirPath}/${fileName}`;
            } while (await this.app.vault.adapter.exists(filePath));
            await this.app.vault.createBinary(filePath, buffer);
            resolve(fileName);
          });
        })
        .on("error", (err) => {
          console.error(`Error downloading image[${url}]:`, err.message);
          reject(err);
        });
    });
  }
};
