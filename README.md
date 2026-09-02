# OZON 畅销商品批量查询（ozon-wts-batch）

OZON 卖家后台「What to Sell / 畅销商品」接口的纯前端 in-page 助手。

- 三种入口：批量粘贴 ID、批量粘贴商品链接、表格粘贴（自动识别 `product/数字` / `sku` / `id` 字段）
- 复用卖家后台登录态（`credentials: include`），无需后端中转
- 串行 + 并发池抓取，每批 ≤ 30 个 ID；可调并发数和间隔
- 实时进度 + 结果表 + 过滤 + 排序 + CSV / JSON 导出

## 用法

1. 浏览器打开 Ozon Seller 后台任意页面（例如 https://seller.ozon.ru/app/analytics/what-to-sell/ozon-bestsellers），完成登录。
2. 在同一浏览器打开本页面：`https://kingf668877-creator.github.io/ozon-wts-batch/`
3. 在「批量 ID」/「链接列表」/「表格粘贴」标签下粘贴内容，点击「▶ 开始查询」。
4. 完成后点击「导出 CSV」或「导出 JSON」。

## 接口说明

页面调用以下接口：

```
POST https://api.seller.ozon.ru/api/site/seller-analytics/what_to_sell/data/v3
Content-Type: application/json
```

请求体（单 ID 模式）：

```json
{
  "limit": "50",
  "offset": "0",
  "filter": {
    "stock": "any_stock",
    "period": "weekly",
    "categories": [],
    "sku": "140030730"
  },
  "sort": { "key": "sum_missed_gmv", "order": "desc" }
}
```

返回：

```json
{
  "items": [ { "sku": "...", "name": "...", "brand": "...", "link": "...", "gmvSum": ..., ... } ],
  "totals": "..."
}
```

每个 SKU 调用一次接口；如果输入 N 个 ID，会并发地发出 N 次 `fetch`。返回多个结果时，按 SKU 去重。

## 本地运行

```
python -m http.server 5443
# 浏览器访问 http://localhost:5443/
```

或直接双击 `index.html` 也能打开（但浏览器对 `file://` 下的 `credentials: include` 处理不一致，建议起 HTTP 服务）。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `index.html` | 单页应用入口 |
| `css/style.css` | UI 样式 |
| `js/app.js` | 全部前端逻辑（解析 / 并发 / 渲染 / 导出） |
| `.gitignore` | 忽略运行期生成的文件 |

## 安全说明

- 所有调用走卖家后台自带的 Cookie，不写入本地任何文件。
- 不会向第三方域发送任何数据。

## License

MIT.
