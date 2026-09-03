/* OZON 畅销商品批量查询 · 前端逻辑 */
(function () {
  'use strict';

  const API_URL = 'https://yidong.dianleida.net:21999/api/wts/query';
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
    sortKey: $('#sort-key')
  };
  const state = { rows: [], aborted: false, running: false, seenSku: new Set(), controller: null };

  els.tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      els.tabs.forEach(function (item) { item.classList.toggle('active', item === tab); });
      els.panels.forEach(function (panel) { panel.classList.toggle('active', panel.dataset.tab === tab.dataset.tab); });
    });
  });

  function currentInput() {
    var active = document.querySelector('.tab-panel.active');
    return active ? (els.inputs[active.dataset.tab].value || '') : '';
  }

  function parseIds() {
    var items = currentInput().split(/[\s,;\t\n]+/).map(function (value) {
      return value.replace(/^["'`]+|["'`]+$/g, '').trim();
    }).filter(Boolean);
    var seen = {};
    var output = [];

    items.forEach(function (item) {
      var sku = extractSku(item);
      if (sku && !seen[sku]) {
        seen[sku] = true;
        output.push(sku);
      }
    });
    return output;
  }

  function extractSku(text) {
    if (!text) return '';
    var fromLink = text.match(/ozon\.ru\/product\/(?:[^/?#]*-)?(\d{5,12})(?:[/?#]|$)/i);
    if (fromLink) return fromLink[1];
    var labelled = text.match(/(?:^|\b)(?:sku|id|product)[ _:=-]+(\d{5,12})\b/i);
    if (labelled) return labelled[1];
    var plain = text.match(/\b(\d{5,12})\b/);
    return plain ? plain[1] : '';
  }

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
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
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

  function fmtRow(item) {
    return {
      sku: item.sku || '',
      name: item.name || '',
      brand: item.brand || '',
      category1: item.category1 || '',
      category2: item.category2 || '',
      category3: item.category3 || '',
      link: item.link || '',
      photo: item.photo || '',
      gmvSum: Number(item.gmvSum || 0),
      soldCount: Number(item.soldCount || 0),
      minSellerPrice: Number(item.minSellerPrice || 0),
      avgGmv: Number(item.avgGmv || 0),
      sumMissedGmv: Number(item.sumMissedGmv || 0),
      salesDynamics: Number(item.nullableSalesDynamics ?? item.salesDynamics ?? 0),
      avgGmvOnAccDays: Number(item.avgGmvOnAccDays || 0),
      avgOrdersOnAccDays: Number(item.avgOrdersOnAccDays || 0),
      sessionCountSearch: Number(item.sessionCountSearch || 0),
      sessionCount: Number(item.sessionCount || 0),
      convToCartSearch: Number(item.convToCartSearch || 0),
      pdpToCartConversion: Number(item.pdpToCartConversion || 0),
      advCostShare: Number(item.advCostShare || 0),
      nullableBuyoutShare: Number(item.nullableBuyoutRate ?? item.nullableBuyoutShare ?? 0),
      nullableCreateDate: item.nullableCreateDate || '',
      fboCommission: Number(item.fboCommission || 0),
      fbsCommission: Number(item.fbsCommission || 0),
      salesSchema: item.salesSchema || '',
      volume: Number(item.volume || 0)
    };
  }

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function render() {
    var filter = (els.filter.value || '').toLowerCase();
    var sortKey = els.sortKey.value;
    var rows = state.rows.slice();

    if (filter) {
      rows = rows.filter(function (row) {
        return [row.sku, row.name, row.brand, row.category3, row.category1].some(function (value) {
          return String(value || '').toLowerCase().indexOf(filter) >= 0;
        });
      });
    }
    rows.sort(function (a, b) { return (b[sortKey] || 0) - (a[sortKey] || 0); });
    els.count.textContent = rows.length;
    els.body.innerHTML = rows.length ? '' : '<tr class="empty"><td colspan="12">' + (state.rows.length ? '过滤无结果' : '暂无数据') + '</td></tr>';

    var fragment = document.createDocumentFragment();
    rows.forEach(function (row, index) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (index + 1) + '</td>' +
        '<td class="sku"><a href="' + esc(row.link) + '" target="_blank" rel="noopener">' + esc(row.sku) + '</a></td>' +
        '<td><div class="product-cell">' + (row.photo ? '<img src="' + esc(row.photo) + '" loading="lazy" />' : '') + '<span>' + esc(row.name) + '</span></div></td>' +
        '<td>' + (esc(row.brand) || '-') + '</td>' +
        '<td>' + (esc(row.category3) || esc(row.category1) || '-') + '</td>' +
        '<td>' + (row.gmvSum || 0).toLocaleString() + '</td>' +
        '<td>' + (row.soldCount || 0).toLocaleString() + '</td>' +
        '<td>' + (row.avgGmv || 0).toLocaleString() + '</td>' +
        '<td>' + (row.sumMissedGmv || 0).toLocaleString() + '</td>' +
        '<td>' + row.salesDynamics + '%</td>' +
        '<td>' + (row.pdpToCartConversion || 0).toFixed(2) + '%</td>' +
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
    var headers = ['sku', 'name', 'brand', 'category1', 'category2', 'category3', 'link', 'photo', 'gmvSum', 'soldCount', 'minSellerPrice', 'avgGmv', 'sumMissedGmv', 'salesDynamics', 'avgGmvOnAccDays', 'avgOrdersOnAccDays', 'sessionCountSearch', 'sessionCount', 'convToCartSearch', 'pdpToCartConversion', 'advCostShare', 'nullableBuyoutShare', 'nullableCreateDate', 'fboCommission', 'fbsCommission', 'salesSchema', 'volume'];
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
    render();
    setStatus('', '等待输入...');
    setProgress(0, 0);
  });
  els.exportCsv.addEventListener('click', exportCsv);
  els.exportJson.addEventListener('click', exportJson);
  els.filter.addEventListener('input', render);
  els.sortKey.addEventListener('change', render);
  render();
})();
