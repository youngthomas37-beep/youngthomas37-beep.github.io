# 公开 IGC 记录

页面通过 GitHub Contents API **自动发现**本目录里的 `.igc` 文件，因此新增记录不需要修改清单：

1. 把 `.igc` 文件放进本目录。
2. 提交到 `main` 分支。
3. 刷新 Flight Lab，记录会出现在“公开”筛选里。

也可以直接在 Flight Lab 的「站点维护者 · 发布本机记录」面板中，用 GitHub fine-grained token（本仓库 `Contents: Read and write`）发布；页面会把本机记录合并成一次 commit。

## 可选清单

如果 GitHub API 暂时不可用，页面会回退读取 `index.json`：

```json
{
  "flights": [
    {
      "name": "2026-07-19.Thomas_Young.IGC",
      "date": "2026-07-19",
      "src": "flight-data/igc/2026-07-19.Thomas_Young.IGC"
    }
  ]
}
```

## 注意

- 只放愿意公开的轨迹；IGC 可能暴露起降地点和个人活动规律。
- 文件名建议保留 `YYYY-MM-DD`，页面会从文件名推断日期。
- 访客在页面上的普通上传只保存在访客自己的浏览器（IndexedDB），不会自动写入本目录。
- 发布面板里的 token 只用于 `api.github.com`，不会写入页面或仓库；建议使用仅限本仓库的 fine-grained token。
