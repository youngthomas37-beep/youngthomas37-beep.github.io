# 网站内容维护

网站是直接由 GitHub Pages 展示的静态网页，不需要安装依赖或运行构建。

## 文件与栏目

- `index.html`：首页简介、栏目入口、近况。
- `research.html`：理论物理与数学课题、进展和成果。
- `play.html`：现有俄罗斯方块、数独与魔方作品。
- `flight.html`：滑翔伞照片和视频；影像目录从 `flight-media.json` 读取。
- `apps.html`：小程序的计划与将来的作品入口。
- `crypto.html`：个人加密货币项目的构想与进展。
- `notes.html`：阅读笔记、问题簿与随想。
- `about.html`、`archive.html`：关于和全站目录。
- `site.css`、`site.js`：新页面的共享样式与交互。

## 添加飞行照片或视频

1. 将愿意公开的图片放到 `media/photos/`；视频可放 `media/videos/`，或使用自己可公开访问的 HTTPS 视频直链。文件名建议用英文和连字符。大视频宜用适合视频的托管服务；普通视频网页链接不能作为直接播放地址。
2. 在 `flight-media.json` 数组中添加记录。例如下面只是格式示意，并非真实飞行记录，勿直接发布这些示例：

```json
[
  {
    "type": "photo",
    "title": "填写真实标题",
    "date": "YYYY-MM-DD",
    "src": "media/photos/your-photo.jpg",
    "alt": "简要描述照片内容",
    "location": "愿意公开时填写",
    "caption": "可选的文字记录"
  },
  {
    "type": "video",
    "title": "填写真实视频标题",
    "date": "YYYY-MM-DD",
    "src": "https://your-video-host.example/video.mp4",
    "poster": "media/photos/your-video-cover.jpg"
  }
]
```

3. 用真实日期替换日期示意；日期统一为 `YYYY-MM-DD`。`location`、`caption`、`poster` 可以省略。新纪录按日期倒序出现，照片/视频过滤及照片放大自动可用。
4. 发布后确认图像/视频能打开。这里没有在线上传后台；提交到公开仓库的资料会公开，请只放愿意公开的内容。

## 添加文章、成果与小程序

文章建议保留独立 `.html` 地址，使用共享的 `site.css`。在所属栏目增加标题、真实日期、摘要和链接，并更新首页近况。在 `site.js` 的 `entries` 中补充站内查找的入口。尚未发表的论文、未完成的小程序、尚未发行的项目应按真实状态标注。

## 保留原有作品

旧数独、魔方与俄罗斯方块的路径不变；这些作品保留自己的界面，不引用新主页样式。
