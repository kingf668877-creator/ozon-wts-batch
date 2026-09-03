/* OZON 畅销商品批量查询 · 前端逻辑 */
(function () {
  'use strict';

  const API_URL = 'https://yidong.dianleida.net:21999/api/wts/query';
  const SHEETJS_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  const $ = function (selector) { return document.querySelector(selector); };

  const els = {
    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('.tab-panel'),
    inputs: {
      ids: $('#input-ids'),
      links: $('#input-links'),
      table: $('#input-table')
    },
    batch: $('#batch-size'),
    interval: $('#interval'),
    run: $('#run-btn'),
    stop: $('#stop-btn'),
    exportCsv: $('#export-csv'),
    exportJson: $('#export-json'),
    clear: $('#clear-btn'),
    status: $('#status'),
    statusText: $('#status-text'),
    progressBar: $('#progress-bar'),
    progressText: $('#progress-text'),
    body: $('#result-body'),
    count: $('#result-count'),
    filter: $('#filter-input'),
    sortKey: $('#sort-key'),
    fileInput: $('#file-input'),
    fileSample: $('#file-sample'),
    previewBody: $('#preview-body'),
    previewSummary: $('#preview-summary'),
    previewSelectAll: $('#preview-select-all')
  };

  const state = {
    rows: [],
    aborted: false,
    running: false,
    seenSku: new Set(),
    controller: null,
    preview: [],
    fileLoaded: false
  };

  /* ----------- Tab 切换 ----------- */
  els.tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      els.tabs.forEach(function (item) { item.classList.toggle('active', item === tab); });
      els.panels.forEach(function (panel) { panel.classList.toggle('active', panel.dataset.tab === tab.dataset.tab); });
    });
  });

  /* ----------- 解析：把任意输入拆成 {raw, sku, type, ok, selected} 列表 ----------- */
  function extractSku(text) {
    if (!text) return '';
    var fromLink = text.match(/ozon\.ru\/product\/(?:[^/?#]*-)?(\d{5,12})(?:[/?#]|$)/i);
    if (fromLink) return fromLink[1];
    var labelled = text.match(/(?:^|\b)(?:sku|id|product|article|货号)[ _:=-]+(\d{5,12})\b/i);
    if (labelled) return labelled[1];
    var plain = text.match(/\b(\d{5,12})\b/);
    return plain ? plain[1] : '';
  }

  function classify(raw) {
    if (!raw) return { ok: false, reason: '空内容' };
    var sku = extractSku(String(raw));
    if (!sku) return { ok: false, reason: '未识别出 ID' };
    var isLink = /ozon\.ru\/product\//i.test(String(raw));
    return { ok: true, sku: sku, type: isLink ? 'link' : 'id', reason: '' };
  }

  function tokenize(text) {
    if (!text) return [];
    return String(text).split(/\r?\n|[\t;,]+/).map(function (line) {
      return line.replace(/^["'`\s]+|["'`\s]+$/g, '');
    }).filter(Boolean);
  }

  function buildPreview(items) {
    var seen = {};
    var preview = [];
    items.forEach(function (raw, idx) {
      var parsed = classify(raw);
      var key = parsed.sku || ('raw:' + idx + ':' + raw);
      var dedupe = parsed.ok && seen[key];
      preview.push({
        index: idx + 1,
        raw: raw,
        sku: parsed.sku || '',
        type: parsed.type || '',
        ok: parsed.ok,
        reason: dedupe ? '重复' : (parsed.reason || ''),
        selected: parsed.ok && !dedupe,
        duplicate: dedupe
      });
      if (parsed.ok && !dedupe) seen[key] = true;
    });
    return preview;
  }

  function parseTableText(text) {
    return tokenize(text);
  }

  function parseDelimitedRows(text) {
    return tokenize(text);
  }

  function parseFileRows(rows) {
    var out = [];
    rows.forEach(function (row) {
      if (!Array.isArray(row)) return;
      row.forEach(function (cell) {
        if (cell == null) return;
        var value = String(cell).trim();
        if (value) out.push(value);
      });
    });
    return out;
  }

  function currentTabName() {
    var active = document.querySelector('.tab-panel.active');
    return active ? active.dataset.tab : '';
  }

  function currentInput() {
    var tab = currentTabName();
    return tab && els.inputs[tab] ? (els.inputs[tab].value || '') : '';
  }

  function refreshPreview() {
    var items = state.fileLoaded ? flatFileItems() : parseTableText(currentInput());
    state.preview = buildPreview(items);
    renderPreview();
  }

  function flatFileItems() {
    return state.preview.map(function (item) { return item.raw; });
  }

  function renderPreview() {
    var preview = state.preview;
    if (!preview.length) {
      els.previewBody.innerHTML = '<tr class="empty"><td colspan="5">未识别到任何 ID。请上传文件或在表格粘贴框中输入内容。</td></tr>';
      els.previewSummary.textContent = '0 条';
      return;
    }

    var html = preview.map(function (item) {
      var tag = '';
      var status = '';
      if (item.ok && !item.duplicate) {
        tag = item.type === 'link'
          ? '<span class="link-tag">链接 → ' + esc(item.sku) + '</span>'
          : '<span class="sku-tag">SKU ' + esc(item.sku) + '</span>';
        status = '<span class="ok">✓ 已识别</span>';
      } else if (item.duplicate) {
        tag = '<span class="warn-tag">' + esc(item.reason || '重复') + '</span>';
        status = '<span class="bad">重复</span>';
      } else {
        tag = '<span class="warn-tag">' + esc(item.reason || '未识别') + '</span>';
        status = '<span class="bad">跳过</span>';
      }

      var checked = item.selected ? 'checked' : '';
      var disabled = (item.ok && !item.duplicate) ? '' : 'disabled';

      return '<tr data-index="' + (item.index - 1) + '">' +
        '<td class="col-check"><input type="checkbox" class="row-check" ' + checked + ' ' + disabled + ' /></td>' +
        '<td>' + item.index + '</td>' +
        '<td class="raw" title="' + esc(item.raw) + '">' + esc(item.raw) + '</td>' +
        '<td>' + tag + '</td>' +
        '<td>' + status + '</td>' +
        '</tr>';
    }).join('');

    els.previewBody.innerHTML = html;
    var selectedCount = preview.filter(function (p) { return p.selected; }).length;
    els.previewSummary.textContent = '共 ' + preview.length + ' 行，已选 ' + selectedCount + ' 条有效 ID';
  }

  function selectedIds() {
    return state.preview
      .filter(function (p) { return p.selected && p.ok && !p.duplicate; })
      .map(function (p) { return p.sku; });
  }

  function parseIds() {
    if (currentTabName() === 'table' && state.fileLoaded) {
      return selectedIds();
    }
    var preview = buildPreview(parseTableText(currentInput()));
    state.preview = preview;
    renderPreview();
    return preview.filter(function (p) { return p.ok && !p.duplicate; }).map(function (p) { return p.sku; });
  }

  /* ----------- SheetJS 按需加载 ----------- */
  function ensureSheetJs() {
    if (typeof window.XLSX !== 'undefined') return Promise.resolve(window.XLSX);
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = SHEETJS_CDN;
      script.async = true;
      script.onload = function () { resolve(window.XLSX); };
      script.onerror = function () { reject(new Error('无法加载 SheetJS（请检查网络）')); };
      document.head.appendChild(script);
    });
  }

  /* ----------- 文件读取 ----------- */
  async function handleFile(file) {
    if (!file) return;
    setStatus('', '正在解析文件 ' + file.name + ' ...');
    var name = (file.name || '').toLowerCase();
    try {
      var items = [];
      if (name.endsWith('.csv') || name.endsWith('.txt')) {
        var text = await readFileAsText(file);
        items = parseDelimitedRows(text);
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        var XLSX = await ensureSheetJs();
        var buffer = await readFileAsArrayBuffer(file);
        var workbook = XLSX.read(buffer, { type: 'array' });
        workbook.SheetNames.forEach(function (sheetName) {
          var sheet = workbook.Sheets[sheetName];
          var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
          items = items.concat(parseFileRows(rows));
        });
      } else {
        throw new Error('暂不支持的文件类型：' + file.name);
      }

      if (!items.length) {
        state.preview = [];
        renderPreview();
        setStatus('error', '文件为空或没有识别到内容');
        return;
      }

      state.fileLoaded = true;
      state.preview = buildPreview(items);
      renderPreview();
      setStatus('success', '已解析 ' + items.length + ' 行（文件：' + file.name + '）');
    } catch (error) {
      setStatus('error', '文件解析失败：' + error.message);
    }
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('读取失败')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('读取失败')); };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ----------- 调用桥接 ----------- */
  function friendlyError(data, status) {
    var code = data && (data.code || data.errorCode);
    var raw = data && ((data.error && (data.error.message || data.error.detail || data.error)) || data.message);
    if (code === 'seller_not_authenticated' || status === 401) {
      return 'Ozon Seller 登录已失效，请在专用 Chrome 中重新登录';
    }
    if (code === 'seller_tab_not_found') {
      return '未找到 Seller 页面，请先运行桌面“一键启动图搜”';
    }
    if (status === 429) {
      return '查询过于频繁，请稍后重试';
    }
    if (status >= 500) {
      return '本地查询服务暂时不可用，请确认“一键启动图搜”正在运行';
    }
    return typeof raw === 'string' ? raw : '查询失败（HTTP ' + status + '）';
  }

  async function callBatch(ids, signal) {
    var response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: ids }),
        signal: signal
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      throw new Error('无法连接查询服务，请确认桌面“一键启动图搜”和公网映射均已运行');
    }

    var data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('服务返回了无法解析的数据（HTTP ' + response.status + '）');
    }
    if (!response.ok) throw new Error(friendlyError(data, response.status));
    return data;
  }

  /* ----------- 渲染辅助 ----------- */
  function fmtMoney(value) {
    var number = Number(value || 0);
    if (!isFinite(number)) number = 0;
    return number.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
  }

  function fmtNumber(value) {
    var number = Number(value || 0);
    if (!isFinite(number)) number = 0;
    return number.toLocaleString('en-US');
  }

  function fmtPercent(value) {
    var number = Number(value || 0);
    if (!isFinite(number)) number = 0;
    return number.toFixed(2) + '%';
  }

  function fmtDate(value) {
    if (!value) return '-';
    var text = String(value);
    var match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : text;
  }

  function fmtRow(item) {
    var fbo = Number(item.fboStock || 0);
    var fbs = Number(item.fbsStock || 0);
    var stock = Number(item.stock || 0) || (fbo + fbs);
    return {
      sku: item.sku || '',
      name: item.name || '',
      brand: item.brand || '',
      category1: item.category1 || '',
      category2: item.category2 || '',
      category3: item.category3 || '',
      link: item.link || '',
      photo: item.photo || '',
      article: item.article || '',
      volume: Number(item.volume || 0),
      soldSum: Number(item.soldSum || item.gmvSum || 0),
      soldCount: Number(item.soldCount || 0),
      minSellerPrice: Number(item.minSellerPrice || 0),
      avgPrice: Number(item.avgPrice || item.avgGmv || 0),
      sumMissedGmv: Number(item.sumMissedGmv || 0),
      salesDynamics: Number(item.salesDynamics || 0),
      views: Number(item.views || 0),
      stock: stock,
      nullableCreateDate: item.nullableCreateDate || '',
      pdpToCartConversion: Number(item.pdpToCartConversion || 0),
      avgOrdersOnAccDays: Number(item.avgOrdersOnAccDays || 0),
      sessionCount: Number(item.sessionCount || 0),
      sessionCountSearch: Number(item.sessionCountSearch || 0),
      convToCartSearch: Number(item.convToCartSearch || 0),
      drr: Number(item.drr || 0),
      discount: Number(item.discount || 0),
      avgDeliveryDays: Number(item.avgDeliveryDays || 0),
      accessibility: Number(item.accessibility || 0),
      salesSchema: item.salesSchema || ''
    };
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function render() {
    var filter = (els.filter.value || '').toLowerCase();
    var sortKey = els.sortKey.value;
    var rows = state.rows.slice();

    if (filter) {
      rows = rows.filter(function (row) {
        return [row.sku, row.name, row.brand, row.category3, row.category1, row.article].some(function (value) {
          return String(value || '').toLowerCase().indexOf(filter) >= 0;
        });
      });
    }
    rows.sort(function (a, b) { return (b[sortKey] || 0) - (a[sortKey] || 0); });
    els.count.textContent = rows.length;
    els.body.innerHTML = rows.length ? '' : '<tr class="empty"><td colspan="15">' + (state.rows.length ? '过滤无结果' : '暂无数据') + '</td></tr>';

    var fragment = document.createDocumentFragment();
    rows.forEach(function (row, index) {
      var dynamics = row.salesDynamics || 0;
      var dynamicCls = dynamics > 0 ? 'gmv-up' : (dynamics < 0 ? 'gmv-down' : '');
      var dynamicSymbol = dynamics > 0 ? '+' : '';
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="col-num">' + (index + 1) + '</td>' +
        '<td class="col-sku"><a href="' + esc(row.link) + '" target="_blank" rel="noopener">' + esc(row.sku) + '</a></td>' +
        '<td><div class="product-cell">' + (row.photo ? '<img src="' + esc(row.photo) + '" loading="lazy" />' : '') + '<div><div class="name">' + esc(row.name) + '</div><div class="muted" style="font-size:11px;color:var(--muted)">货号 ' + esc(row.article || '-') + ' · 体积 ' + (row.volume || 0).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' L</div></div></div></td>' +
        '<td>' + (esc(row.brand) || '-') + '</td>' +
        '<td>' + (esc(row.category3) || esc(row.category1) || '-') + '</td>' +
        '<td class="num">' + fmtMoney(row.soldSum) + '</td>' +
        '<td class="num">' + fmtNumber(row.soldCount) + '</td>' +
        '<td class="num">' + fmtMoney(row.minSellerPrice) + '</td>' +
        '<td class="num">' + fmtMoney(row.avgPrice) + '</td>' +
        '<td class="num">' + fmtMoney(row.sumMissedGmv) + '</td>' +
        '<td class="num ' + dynamicCls + '">' + dynamicSymbol + dynamics.toFixed(2) + '%</td>' +
        '<td class="num">' + fmtPercent(row.pdpToCartConversion) + '</td>' +
        '<td class="num">' + fmtNumber(row.views) + '</td>' +
        '<td class="num">' + fmtNumber(row.stock) + '</td>' +
        '<td>' + fmtDate(row.nullableCreateDate) + '</td>' +
        '<td><a href="' + esc(row.link) + '" target="_blank" rel="noopener">查看</a></td>';
      fragment.appendChild(tr);
    });
    els.body.appendChild(fragment);
    els.exportCsv.disabled = state.rows.length === 0;
    els.exportJson.disabled = state.rows.length === 0;
  }

  function setStatus(cssClass, text) {
    els.status.classList.remove('running', 'success', 'error');
    if (cssClass) els.status.classList.add(cssClass);
    els.statusText.textContent = text;
  }

  function setProgress(done, total) {
    var percentage = total ? Math.min(100, Math.round(done / total * 100)) : 0;
    els.progressBar.style.setProperty('--p', percentage + '%');
    els.progressText.textContent = done + ' / ' + total;
  }

  function clamp(number, min, max) {
    number = Number(number);
    return isNaN(number) ? min : Math.max(min, Math.min(max, number));
  }

  function wait(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
  }

  async function run() {
    if (state.running) return;
    var ids = parseIds();
    if (!ids.length) {
      setStatus('error', '没有解析到 ID');
      return;
    }

    state.rows = [];
    state.aborted = false;
    state.seenSku = new Set();
    state.running = true;
    els.run.disabled = true;
    els.stop.disabled = false;
    render();

    var batchSize = clamp(parseInt(els.batch.value, 10) || 12, 1, 12);
    var interval = clamp(parseInt(els.interval.value, 10) || 0, 0, 5000);
    var total = ids.length;
    var done = 0;
    var failed = [];
    var controller = new AbortController();
    state.controller = controller;
    setProgress(0, total);

    try {
      for (var index = 0; index < ids.length; index += batchSize) {
        if (state.aborted) break;
        var batch = ids.slice(index, index + batchSize);
        setStatus('running', '正在查询 ' + (done + 1) + ' - ' + Math.min(done + batch.length, total) + '，共 ' + total + ' 个 ID');
        var data = await callBatch(batch, controller.signal);
        var results = Array.isArray(data.results) ? data.results : [];
        var bySku = {};

        results.forEach(function (result) {
          var requested = String(result.requestedSku || result.sku || '');
          if (requested) bySku[requested] = result;
        });

        batch.forEach(function (requestedSku, batchIndex) {
          var result = bySku[requestedSku] || results[batchIndex];
          var items = result && Array.isArray(result.items) ? result.items : [];
          var matchedItem = items.find(function (item) { return String(item.sku || '') === requestedSku; });

          if (result && result.ok && result.matched && matchedItem) {
            var row = fmtRow(matchedItem);
            if (!state.seenSku.has(row.sku)) {
              state.seenSku.add(row.sku);
              state.rows.push(row);
            }
          } else {
            failed.push(requestedSku);
          }
        });

        done += batch.length;
        setProgress(done, total);
        render();
        if (interval > 0 && done < total) await wait(interval);
      }

      if (state.aborted) {
        setStatus('error', '已停止，已完成 ' + done + ' / ' + total + '，获得 ' + state.rows.length + ' 条结果');
      } else if (failed.length) {
        setStatus('error', '查询完成：成功 ' + state.rows.length + ' 条，未匹配 ' + failed.length + ' 个（' + failed.join('、') + '）');
      } else {
        setStatus('success', '查询完成，共 ' + state.rows.length + ' 条');
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        setStatus('error', '已停止，已完成 ' + done + ' / ' + total + '，获得 ' + state.rows.length + ' 条结果');
      } else {
        setStatus('error', '查询失败：' + (error.message || String(error)));
      }
    } finally {
      state.running = false;
      state.controller = null;
      els.run.disabled = false;
      els.stop.disabled = true;
    }
  }

  function exportCsv() {
    var headers = ['sku', 'name', 'brand', 'category1', 'category2', 'category3', 'link', 'photo', 'article', 'volume_l', 'soldSum_rub', 'soldCount', 'minSellerPrice_rub', 'avgPrice_rub', 'sumMissedGmv_rub', 'salesDynamics_pct', 'pdpToCartConversion_pct', 'views', 'stock', 'avgOrdersOnAccDays', 'sessionCount', 'sessionCountSearch', 'convToCartSearch', 'drr', 'discount', 'avgDeliveryDays', 'accessibility', 'salesSchema', 'nullableCreateDate'];
    var escapeCsv = function (value) {
      var text = String(value == null ? '' : value);
      return /[",\n]/.test(text) ? ('"' + text.replace(/"/g, '""') + '"') : text;
    };
    var output = [headers.join(',')];
    state.rows.forEach(function (row) {
      output.push(headers.map(function (key) { return escapeCsv(row[key]); }).join(','));
    });
    download('\ufeff' + output.join('\n'), 'ozon-wts-result.csv', 'text/csv;charset=utf-8');
  }

  function exportJson() {
    download(JSON.stringify(state.rows, null, 2), 'ozon-wts-result.json', 'application/json');
  }

  function download(text, name, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  }

  /* ----------- 事件绑定 ----------- */
  els.run.addEventListener('click', run);

  els.stop.addEventListener('click', function () {
    state.aborted = true;
    if (state.controller) state.controller.abort();
    setStatus('error', '正在停止...');
  });

  els.clear.addEventListener('click', function () {
    if (state.running) return;
    Object.keys(els.inputs).forEach(function (key) { els.inputs[key].value = ''; });
    state.rows = [];
    state.fileLoaded = false;
    state.preview = [];
    render();
    renderPreview();
    setStatus('', '等待输入...');
    setProgress(0, 0);
  });

  els.exportCsv.addEventListener('click', exportCsv);
  els.exportJson.addEventListener('click', exportJson);
  els.filter.addEventListener('input', render);
  els.sortKey.addEventListener('change', render);

  els.fileInput.addEventListener('change', function () {
    var file = els.fileInput.files && els.fileInput.files[0];
    if (file) handleFile(file);
  });

  els.fileSample.addEventListener('click', function () {
    els.inputs.table.value = [
      'sku\tname',
      '140030730\tКалинов Родник 6L',
      'https://www.ozon.ru/product/149710140',
      '150001234',
      '150001235  (重复测试)',
      '140030730',
      '订单号: 158970015',
      '不是ID的商品名称'
    ].join('\n');
    state.fileLoaded = false;
    refreshPreview();
    setStatus('', '已载入示例，请点击「开始查询」');
  });

  els.inputs.table.addEventListener('input', function () {
    state.fileLoaded = false;
    refreshPreview();
  });

  els.previewSelectAll.addEventListener('change', function () {
    var checked = els.previewSelectAll.checked;
    state.preview.forEach(function (item) {
      if (item.ok && !item.duplicate) item.selected = checked;
    });
    renderPreview();
  });

  els.previewBody.addEventListener('change', function (event) {
    var target = event.target;
    if (!(target && target.classList && target.classList.contains('row-check'))) return;
    var row = target.closest('tr');
    if (!row) return;
    var index = parseInt(row.getAttribute('data-index'), 10);
    if (isNaN(index)) return;
    var item = state.preview[index];
    if (!item) return;
    item.selected = target.checked;
    var total = state.preview.length;
    var selected = state.preview.filter(function (p) { return p.selected; }).length;
    els.previewSummary.textContent = '共 ' + total + ' 行，已选 ' + selected + ' 条有效 ID';
  });

  render();
  renderPreview();
})();