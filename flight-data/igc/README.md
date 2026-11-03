# 公开 IGC 记录

把愿意公开的 `.igc` 文件放进本目录，然后在 `index.json` 中登记：

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

页面会读取这份清单，按日期显示“公开记录”。点击后才下载对应 IGC 并解析，所以清单很大也不会阻塞首屏。

## 注意

- 只放愿意公开的轨迹；IGC 可能暴露起降地点和个人活动规律。
- `name` 是显示名，`src` 是相对站点根目录的路径。
- `date` 建议使用 `YYYY-MM-DD`；缺失时页面会从文件名或 IGC 的 `HFDTE` 推断。
- 不要在这里放 `.zip` 或私人文件。
- 访客在页面上传的文件只保存在访客自己的浏览器（IndexedDB），不会写入这个目录。
