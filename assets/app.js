/* =========================================================
   TorchEBM Benchmarks — Pure Static Client-Side App
   Fetches JSON results at runtime, no build step needed.
   ========================================================= */

const RESULTS_BASE = 'benchmarks/results';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
(function initTheme() {
    const saved = localStorage.getItem('torchebm-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('torchebm-theme', next);
        window.dispatchEvent(new Event('theme-changed'));
    });
})();

// ---------------------------------------------------------------------------
// GitHub stats (version, stars, forks) — fetched live
// ---------------------------------------------------------------------------
(function fetchGitHubStats() {
    fetch('https://api.github.com/repos/soran-ghaderi/torchebm')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (!data) return;
            document.querySelectorAll('#ghStars').forEach(el => el.textContent = data.stargazers_count);
            document.querySelectorAll('#ghForks').forEach(el => el.textContent = data.forks_count);
        }).catch(() => {});
    fetch('https://api.github.com/repos/soran-ghaderi/torchebm/releases/latest')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (!data) return;
            document.querySelectorAll('#ghVersion').forEach(el => el.textContent = data.tag_name);
        }).catch(() => {});
})();

// ---------------------------------------------------------------------------
// Plotly helpers
// ---------------------------------------------------------------------------
const SCALE_COLORS = { small: '#b0eb00', medium: '#bc8cff', large: '#f0883e' };
const MODULE_COLORS = {
    integrators: '#b0eb00', losses: '#3fb950', samplers: '#bc8cff',
    interpolants: '#f0883e', models: '#f85149', unknown: '#8b949e'
};

function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function deepMerge(target, source) {
    const out = Object.assign({}, target);
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
            && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
            out[key] = deepMerge(target[key], source[key]);
        } else {
            out[key] = source[key];
        }
    }
    return out;
}

function plotlyLayout(extra) {
    const dark = isDark();
    const base = {
        paper_bgcolor: dark ? '#1e1e1e' : '#ffffff',
        plot_bgcolor: dark ? '#161616' : '#f6f8fa',
        font: { family: '-apple-system, BlinkMacSystemFont, sans-serif', color: dark ? '#8b949e' : '#656d76', size: 12 },
        margin: { l: 60, r: 20, t: 40, b: 20, pad: 4 },
        xaxis: { gridcolor: dark ? '#222222' : '#e1e4e8', zerolinecolor: dark ? '#2e2e2e' : '#d0d7de', automargin: true },
        yaxis: { gridcolor: dark ? '#222222' : '#e1e4e8', zerolinecolor: dark ? '#2e2e2e' : '#d0d7de', automargin: true },
        legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 11 }, orientation: 'h', x: 0.5, xanchor: 'center', y: 1.02, yanchor: 'bottom' },
        hoverlabel: { font: { family: 'monospace', size: 12 } },
        autosize: true,
    };
    return extra ? deepMerge(base, extra) : base;
}

function plotlyConfig() {
    return { responsive: true, displayModeBar: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'], displaylogo: false };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function geomean(values) {
    const pos = values.filter(v => v > 0);
    if (!pos.length) return 0;
    return Math.exp(pos.reduce((s, v) => s + Math.log(v), 0) / pos.length);
}

function fmtMs(v) { return v != null ? v.toFixed(2) : '\u2014'; }
function fmtPct(v) { return v != null ? (v > 0 ? '+' : '') + v.toFixed(1) + '%' : '\u2014'; }
function fmtSpeedup(v) { return v != null ? v.toFixed(2) + 'x' : '\u2014'; }

function speedupBadge(speedup) {
    if (speedup == null) return '<span class="badge badge-neutral">N/A</span>';
    if (speedup >= 1.05) return `<span class="badge badge-green">${fmtSpeedup(speedup)}</span>`;
    if (speedup >= 0.95) return `<span class="badge badge-yellow">${fmtSpeedup(speedup)}</span>`;
    return `<span class="badge badge-red">${fmtSpeedup(speedup)}</span>`;
}

function setupModuleTabs(containerId, modules, callback) {
    const container = document.getElementById(containerId);
    if (!container) return;
    modules.forEach(mod => {
        const btn = document.createElement('button');
        btn.className = 'tab';
        btn.dataset.module = mod;
        btn.textContent = mod;
        container.appendChild(btn);
    });
    container.addEventListener('click', e => {
        if (!e.target.classList.contains('tab')) return;
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        callback(e.target.dataset.module);
    });
}

// ---------------------------------------------------------------------------
// JSON Parsing — both formats, all in JS
// ---------------------------------------------------------------------------

function versionFromFilename(filename) {
    const m = filename.match(/v?(0\.\d+\.\d+(?:\.dev\d+)?)/);
    return m ? m[1] : null;
}

function extractComponentName(raw) {
    // pytest-benchmark: 'test_component[integrators/EulerMaruyamaIntegrator[small]]'
    let m = raw.match(/\/(\w+)\[/);
    if (m) return m[1];
    // pytest-benchmark test fn: test_score_matching_exact[scale=small]
    m = raw.match(/^test_(\w+)\[/);
    if (m) return m[1].split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    // legacy: name_scale
    let cleaned = raw;
    for (const s of ['_small', '_medium', '_large']) {
        if (cleaned.endsWith(s)) { cleaned = cleaned.slice(0, -s.length); break; }
    }
    return cleaned.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function extractScale(raw, params, extra) {
    if (extra && extra.scale) return extra.scale;
    if (params && params.scale) return params.scale;
    const m = raw.match(/scale[=](\w+)/);
    if (m) return m[1];
    for (const s of ['small', 'medium', 'large']) {
        if (raw.includes(`[${s}]`) || raw.endsWith(`_${s}`)) return s;
    }
    return 'unknown';
}

function extractModule(raw, extra) {
    if (extra && extra.module) return extra.module;
    const m = (raw || '').match(/(\w+)\//);
    return m ? m[1] : 'unknown';
}

function parseVersion(v) {
    v = v.replace(/^v/, '').split('+')[0];
    const parts = v.split(/[.\-]/);
    const result = [];
    for (const p of parts) {
        if (p.startsWith('dev')) { result.push(-1); const n = p.match(/\d+/); result.push(n ? parseInt(n[0]) : 0); }
        else if (p.startsWith('git')) { result.push(-2); result.push(0); }
        else { const n = parseInt(p); result.push(isNaN(n) ? 0 : n); }
    }
    return result;
}

function compareVersions(a, b) {
    const pa = parseVersion(a), pb = parseVersion(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const va = pa[i] || 0, vb = pb[i] || 0;
        if (va !== vb) return va - vb;
    }
    return 0;
}

function parsePytestBenchmark(data, filename) {
    const machine = data.machine_info || {};
    const commit = data.commit_info || {};
    const firstExtra = (data.benchmarks[0] || {}).extra_info || {};

    const device = firstExtra.device || 'cpu';
    const version = versionFromFilename(filename) || (commit.id ? `git-${commit.id.slice(0, 8)}` : 'unknown');

    const run = {
        filename,
        datetime: data.datetime || '',
        version,
        device,
        gpu_name: firstExtra.gpu_name || null,
        cuda_version: firstExtra.cuda_version || null,
        torch_version: null,
        python_version: machine.python_version || null,
        platform: `${machine.system || ''}-${machine.release || ''}-${machine.machine || ''}`,
        commit_id: commit.id || null,
        benchmarks: [],
    };

    for (const bench of (data.benchmarks || [])) {
        const stats = bench.stats || {};
        const extra = bench.extra_info || {};
        const raw = bench.name || bench.fullname || '';
        run.benchmarks.push({
            name: extractComponentName(raw),
            module: extractModule(bench.param || raw, extra),
            scale: extractScale(raw, bench.params, extra),
            device: extra.device || device,
            median_ms: (stats.median || 0) * 1000,
            mean_ms: (stats.mean || 0) * 1000,
            min_ms: (stats.min || 0) * 1000,
            max_ms: (stats.max || 0) * 1000,
            stddev_ms: (stats.stddev || 0) * 1000,
            peak_memory_mb: extra.peak_memory_mb || null,
            samples_per_sec: extra.samples_per_sec || null,
            batch_size: extra.batch_size || null,
            dim: extra.dim || null,
        });
    }
    return run;
}

function parseLegacy(data, filename) {
    const env = data.environment || {};
    const rawVersion = versionFromFilename(filename) || env.torchebm_version || 'unknown';
    const version = rawVersion.split('+')[0];
    const device = env.gpu_name ? 'cuda' : 'cpu';

    const run = {
        filename,
        datetime: env.timestamp || '',
        version,
        device,
        gpu_name: env.gpu_name || null,
        cuda_version: env.cuda_version || null,
        torch_version: env.torch_version || null,
        python_version: env.python_version || null,
        platform: env.platform || null,
        commit_id: null,
        benchmarks: [],
    };

    for (const r of (data.results || [])) {
        const params = r.params || {};
        run.benchmarks.push({
            name: extractComponentName(r.name || ''),
            module: r.module || 'unknown',
            scale: params.scale || extractScale(r.name || '', params, null),
            device: r.device || device,
            median_ms: r.median_ms || 0,
            mean_ms: r.mean_ms || 0,
            min_ms: r.min_ms || 0,
            max_ms: r.max_ms || 0,
            stddev_ms: r.std_ms || 0,
            peak_memory_mb: r.peak_memory_mb || null,
            samples_per_sec: r.samples_per_sec || null,
            batch_size: r.batch_size || null,
            dim: params.dim || null,
        });
    }
    return run;
}

function parseJsonFile(data, filename) {
    if (data.benchmarks && data.machine_info) return parsePytestBenchmark(data, filename);
    if (data.results && data.environment) return parseLegacy(data, filename);
    return null;
}

function deduplicateRuns(runs) {
    const groups = {};
    for (const run of runs) {
        const key = `${run.version}|${run.device}|${run.gpu_name || ''}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(run);
    }
    return Object.values(groups).map(g => {
        g.sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''));
        return g[0];
    });
}

function sortRuns(runs) {
    return runs.sort((a, b) => {
        const vc = compareVersions(a.version, b.version);
        return vc !== 0 ? vc : (a.datetime || '').localeCompare(b.datetime || '');
    });
}

// ---------------------------------------------------------------------------
// Data Loading
// ---------------------------------------------------------------------------

async function loadBenchmarkData() {
    const manifestUrl = `${RESULTS_BASE}/manifest.json`;
    const resp = await fetch(manifestUrl);
    if (!resp.ok) throw new Error(`Failed to load manifest: ${resp.status}`);
    const filenames = await resp.json();

    const results = await Promise.allSettled(
        filenames.map(async fname => {
            const url = `${RESULTS_BASE}/${fname}`;
            const r = await fetch(url);
            if (!r.ok) return null;
            const data = await r.json();
            const baseName = fname.split('/').pop();
            return parseJsonFile(data, baseName);
        })
    );

    let runs = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value)
        .filter(r => r.benchmarks.length > 0);

    runs = deduplicateRuns(runs);
    runs = sortRuns(runs);

    const modules = [...new Set(runs.flatMap(r => r.benchmarks.map(b => b.module)))].sort();
    const versions = [...new Set(runs.map(r => r.version))].sort(compareVersions);

    return { runs, modules, versions };
}

// ---------------------------------------------------------------------------
// Page Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
    const loadingEl = document.getElementById('loading');
    try {
        const data = await loadBenchmarkData();
        if (loadingEl) loadingEl.style.display = 'none';

        // Update footer
        const footer = document.getElementById('footerText');
        if (footer) footer.textContent = `Loaded ${data.runs.length} benchmark runs. Data from torchebm-benchmarks.`;

        // Detect which page we're on and init
        const path = location.pathname;
        if (path.includes('history')) {
            initHistory(data);
        } else if (path.includes('compare')) {
            initCompare(data);
        } else {
            initDashboard(data);
        }
    } catch (err) {
        if (loadingEl) loadingEl.textContent = `Error loading data: ${err.message}`;
        console.error(err);
    }
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function initDashboard(data) {
    const { runs, modules } = data;
    if (!runs.length) return;

    const latestRun = runs[runs.length - 1];
    const prevRun = runs.length > 1 ? runs[runs.length - 2] : null;

    // Hero subtitle
    const hero = document.getElementById('heroSub');
    if (hero) {
        hero.innerHTML = `Performance tracking for <a href="https://github.com/soran-ghaderi/torchebm">TorchEBM</a> \u2014 latest: <strong>v${latestRun.version}</strong> (${(latestRun.datetime || '').slice(0, 10)})`;
    }

    // Environment card
    const envCard = document.getElementById('envCard');
    const envGrid = document.getElementById('envGrid');
    if (envCard && envGrid) {
        const fields = [
            ['GPU', latestRun.gpu_name],
            ['CUDA', latestRun.cuda_version],
            ['PyTorch', latestRun.torch_version],
            ['Python', latestRun.python_version],
            ['OS', latestRun.platform],
        ].filter(([, v]) => v);
        envGrid.innerHTML = fields.map(([label, val]) =>
            `<div class="env-item"><span class="env-label">${label}</span><span class="env-value">${val}</span></div>`
        ).join('');
        envCard.style.display = '';
    }

    // Summary cards
    renderSummaryCards(latestRun, prevRun, modules);

    // Charts
    let currentModule = 'all';
    function renderCharts(mod) {
        currentModule = mod;
        const benchmarks = mod === 'all' ? latestRun.benchmarks : latestRun.benchmarks.filter(b => b.module === mod);
        renderMedianTimeChart(benchmarks);
        renderThroughputChart(benchmarks);
        renderMemoryChart(benchmarks);
        renderScalingChart(benchmarks);
    }

    ['moduleTabsTime', 'moduleTabsThroughput', 'moduleTabsMemory', 'moduleTabsScaling'].forEach(id => {
        setupModuleTabs(id, modules, renderCharts);
    });

    renderCharts('all');
    window.addEventListener('theme-changed', () => renderCharts(currentModule));
}

function renderSummaryCards(run, prevRun, modules) {
    const container = document.getElementById('summaryCards');
    if (!container) return;

    container.innerHTML = modules.map(mod => {
        const benchmarks = run.benchmarks.filter(b => b.module === mod);
        const mediumBench = benchmarks.filter(b => b.scale === 'medium');
        const medians = (mediumBench.length ? mediumBench : benchmarks).map(b => b.median_ms);
        const gm = geomean(medians);
        const count = new Set(benchmarks.map(b => b.name)).size;

        let speedupHtml = '';
        if (prevRun) {
            const prevBench = prevRun.benchmarks.filter(b => b.module === mod);
            const prevMedium = prevBench.filter(b => b.scale === 'medium');
            const prevMedians = (prevMedium.length ? prevMedium : prevBench).map(b => b.median_ms);
            const prevGm = geomean(prevMedians);
            if (prevGm > 0 && gm > 0) speedupHtml = ' ' + speedupBadge(prevGm / gm);
        }

        return `<div class="summary-card">
            <div class="summary-card-title">${mod}</div>
            <div class="summary-card-value">${fmtMs(gm)} ms</div>
            <div class="summary-card-detail">${count} components${speedupHtml}</div>
        </div>`;
    }).join('');
}

function renderMedianTimeChart(benchmarks) {
    const el = document.getElementById('chartMedianTime');
    if (!el) return;
    const components = [...new Set(benchmarks.map(b => b.name))];
    const scales = [...new Set(benchmarks.map(b => b.scale))].sort();
    const traces = scales.map(scale => ({
        name: scale, type: 'bar',
        x: components,
        y: components.map(c => { const b = benchmarks.find(x => x.name === c && x.scale === scale); return b ? b.median_ms : 0; }),
        marker: { color: SCALE_COLORS[scale] || '#8b949e' },
        hovertemplate: '%{x}<br>%{y:.2f} ms<extra>' + scale + '</extra>',
    }));
    Plotly.newPlot(el, traces, plotlyLayout({ barmode: 'group', xaxis: { title: 'Component', tickangle: -30 }, yaxis: { title: 'Median Time (ms)' } }), plotlyConfig());
}

function renderThroughputChart(benchmarks) {
    const el = document.getElementById('chartThroughput');
    if (!el) return;
    const withT = benchmarks.filter(b => b.samples_per_sec > 0);
    if (!withT.length) { el.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)">No throughput data available</p>'; return; }
    const components = [...new Set(withT.map(b => b.name))];
    const scales = [...new Set(withT.map(b => b.scale))].sort();
    const traces = scales.map(scale => ({
        name: scale, type: 'bar',
        x: components,
        y: components.map(c => { const b = withT.find(x => x.name === c && x.scale === scale); return b ? b.samples_per_sec : 0; }),
        marker: { color: SCALE_COLORS[scale] || '#8b949e' },
        hovertemplate: '%{x}<br>%{y:,.0f} samples/sec<extra>' + scale + '</extra>',
    }));
    Plotly.newPlot(el, traces, plotlyLayout({ barmode: 'group', xaxis: { title: 'Component', tickangle: -30 }, yaxis: { title: 'Samples/sec' } }), plotlyConfig());
}

function renderMemoryChart(benchmarks) {
    const el = document.getElementById('chartMemory');
    if (!el) return;
    const withM = benchmarks.filter(b => b.peak_memory_mb > 0);
    if (!withM.length) { el.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)">No memory data available</p>'; return; }
    const components = [...new Set(withM.map(b => b.name))];
    const scales = [...new Set(withM.map(b => b.scale))].sort();
    const traces = scales.map(scale => ({
        name: scale, type: 'bar',
        x: components,
        y: components.map(c => { const b = withM.find(x => x.name === c && x.scale === scale); return b ? b.peak_memory_mb : 0; }),
        marker: { color: SCALE_COLORS[scale] || '#8b949e' },
        hovertemplate: '%{x}<br>%{y:.1f} MB<extra>' + scale + '</extra>',
    }));
    Plotly.newPlot(el, traces, plotlyLayout({ barmode: 'group', xaxis: { title: 'Component', tickangle: -30 }, yaxis: { title: 'Peak Memory (MB)' } }), plotlyConfig());
}

function renderScalingChart(benchmarks) {
    const el = document.getElementById('chartScaling');
    if (!el) return;
    const components = [...new Set(benchmarks.map(b => b.name))];
    const scaleOrder = ['small', 'medium', 'large'];
    const colors = Object.values(MODULE_COLORS);
    const traces = components.map((comp, i) => {
        const cb = benchmarks.filter(b => b.name === comp).sort((a, b) => scaleOrder.indexOf(a.scale) - scaleOrder.indexOf(b.scale));
        return {
            name: comp, type: 'scatter', mode: 'lines+markers',
            x: cb.map(b => b.batch_size || b.scale),
            y: cb.map(b => b.median_ms),
            marker: { size: 7 },
            line: { color: colors[i % colors.length], width: 2 },
            hovertemplate: comp + '<br>Batch: %{x}<br>%{y:.2f} ms<extra></extra>',
        };
    });
    Plotly.newPlot(el, traces, plotlyLayout({ xaxis: { title: 'Batch Size / Scale', type: 'category' }, yaxis: { title: 'Median Time (ms)' } }), plotlyConfig());
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function initHistory(data) {
    const { runs, modules } = data;
    if (runs.length < 2) {
        document.querySelector('.container').innerHTML += '<p style="text-align:center;padding:2rem;color:var(--text-muted)">Need at least 2 runs for history view.</p>';
        return;
    }

    let currentModule = 'all';
    setupModuleTabs('moduleTabsHistory', modules, mod => { currentModule = mod; renderHistoryChart(data, mod); });
    renderHistoryChart(data, 'all');
    renderSpeedupTable(data);
    renderHeatmap(data);
    window.addEventListener('theme-changed', () => { renderHistoryChart(data, currentModule); renderHeatmap(data); });
}

function renderHistoryChart(data, module) {
    const el = document.getElementById('chartHistory');
    if (!el) return;
    const { runs } = data;

    const allComps = new Set();
    let targetScale = 'medium';
    runs.forEach(run => run.benchmarks.forEach(b => {
        if (b.scale === 'medium' && (module === 'all' || b.module === module)) allComps.add(b.name);
    }));
    if (allComps.size === 0) {
        targetScale = null;
        runs.forEach(run => run.benchmarks.forEach(b => {
            if (module === 'all' || b.module === module) allComps.add(b.name);
        }));
    }

    const versions = runs.map(r => r.version);
    const colors = Object.values(MODULE_COLORS);
    const traces = [...allComps].map((comp, i) => ({
        name: comp, type: 'scatter', mode: 'lines+markers',
        x: versions,
        y: runs.map(run => {
            const b = run.benchmarks.find(b => b.name === comp && (targetScale == null || b.scale === targetScale));
            return b ? b.median_ms : null;
        }),
        connectgaps: false,
        marker: { size: 6 },
        line: { color: colors[i % colors.length], width: 2 },
        hovertemplate: comp + '<br>v%{x}<br>%{y:.2f} ms<extra></extra>',
    }));
    Plotly.newPlot(el, traces, plotlyLayout({ xaxis: { title: 'Version', type: 'category' }, yaxis: { title: 'Median Time (ms)' } }), plotlyConfig());
}

function renderSpeedupTable(data) {
    const el = document.getElementById('speedupTable');
    if (!el) return;
    let html = '<table><thead><tr><th>Transition</th><th>Geomean Speedup</th><th>Top Improvements</th><th>Top Regressions</th></tr></thead><tbody>';

    for (let i = 1; i < data.runs.length; i++) {
        const prev = data.runs[i - 1], curr = data.runs[i];
        const speedups = [];
        curr.benchmarks.forEach(cb => {
            const pb = prev.benchmarks.find(p => p.name === cb.name && p.scale === cb.scale);
            if (pb && pb.median_ms > 0 && cb.median_ms > 0) speedups.push({ name: `${cb.name} [${cb.scale}]`, speedup: pb.median_ms / cb.median_ms });
        });
        if (!speedups.length) continue;
        const gm = geomean(speedups.map(s => s.speedup));
        speedups.sort((a, b) => b.speedup - a.speedup);
        const impr = speedups.filter(s => s.speedup > 1.05).slice(0, 3);
        const regr = speedups.filter(s => s.speedup < 0.95).sort((a, b) => a.speedup - b.speedup).slice(0, 3);
        html += `<tr><td>${prev.version} &rarr; ${curr.version}</td><td>${speedupBadge(gm)}</td>
            <td>${impr.map(s => `${s.name}: ${fmtSpeedup(s.speedup)}`).join('<br>') || '\u2014'}</td>
            <td>${regr.map(s => `${s.name}: ${fmtSpeedup(s.speedup)}`).join('<br>') || '\u2014'}</td></tr>`;
    }
    html += '</tbody></table>';
    el.innerHTML = html;
}

function renderHeatmap(data) {
    const el = document.getElementById('chartHeatmap');
    if (!el) return;
    const { runs } = data;
    const allComps = [...new Set(runs.flatMap(r => r.benchmarks.map(b => `${b.name} [${b.scale}]`)))].sort();
    const transitions = [], z = [];

    for (let i = 1; i < runs.length; i++) {
        const prev = runs[i - 1], curr = runs[i];
        transitions.push(`${prev.version} \u2192 ${curr.version}`);
        z.push(allComps.map(ck => {
            const [name, scale] = ck.replace(']', '').split(' [');
            const pb = prev.benchmarks.find(b => b.name === name && b.scale === scale);
            const cb = curr.benchmarks.find(b => b.name === name && b.scale === scale);
            return (pb && cb && pb.median_ms > 0 && cb.median_ms > 0) ? pb.median_ms / cb.median_ms : null;
        }));
    }
    if (!transitions.length) { el.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)">Not enough data for heatmap</p>'; return; }

    Plotly.newPlot(el, [{
        type: 'heatmap', x: allComps, y: transitions, z,
        colorscale: [[0,'#f85149'],[0.4,'#f85149'],[0.45,'#d29922'],[0.5,'#8b949e'],[0.55,'#d29922'],[0.6,'#3fb950'],[1,'#3fb950']],
        zmid: 1, zmin: 0.5, zmax: 1.5, hoverongaps: false,
        hovertemplate: '%{x}<br>%{y}<br>Speedup: %{z:.2f}x<extra></extra>',
        colorbar: { title: 'Speedup', tickvals: [0.5,0.75,1,1.25,1.5], ticktext: ['0.5x','0.75x','1x','1.25x','1.5x'] },
    }], plotlyLayout({ xaxis: { tickangle: -40, side: 'bottom' }, yaxis: { autorange: 'reversed' }, margin: { l: 150, b: 120 } }), plotlyConfig());
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

function initCompare(data) {
    const { runs } = data;
    if (runs.length < 2) return;

    const baseSelect = document.getElementById('baselineSelect');
    const currSelect = document.getElementById('currentSelect');
    const controls = document.getElementById('compareControls');

    runs.forEach((run, i) => {
        const label = `${run.version} \u2014 ${(run.datetime || '').slice(0, 10)} \u2014 ${run.gpu_name || run.device}`;
        baseSelect.add(new Option(label, i));
        currSelect.add(new Option(label, i));
    });
    baseSelect.value = runs.length - 2;
    currSelect.value = runs.length - 1;
    controls.style.display = '';

    function doCompare() {
        const baseline = runs[+baseSelect.value];
        const current = runs[+currSelect.value];
        renderEnvDiff(baseline, current);
        renderBenchDiff(baseline, current);
        renderSpeedupChart(baseline, current);
        renderCompareSummary(baseline, current);
        ['compareEnvSection', 'compareBenchSection', 'compareChartSection', 'compareSummary'].forEach(id => {
            document.getElementById(id).style.display = '';
        });
    }

    document.getElementById('btnCompare').addEventListener('click', doCompare);
    window.addEventListener('theme-changed', doCompare);
    doCompare();
}

function renderEnvDiff(baseline, current) {
    const el = document.getElementById('envDiffTable');
    const fields = [['Version','version'],['Device','device'],['GPU','gpu_name'],['CUDA','cuda_version'],['PyTorch','torch_version'],['Python','python_version'],['Platform','platform'],['Commit','commit_id']];
    let html = '<table><thead><tr><th>Field</th><th>Baseline</th><th>Current</th></tr></thead><tbody>';
    fields.forEach(([label, key]) => {
        const bv = baseline[key] || '\u2014', cv = current[key] || '\u2014';
        const diff = bv !== cv ? ' style="color:var(--accent)"' : '';
        html += `<tr><td style="font-family:var(--font-sans)">${label}</td><td>${bv}</td><td${diff}>${cv}</td></tr>`;
    });
    el.innerHTML = html + '</tbody></table>';
}

function renderBenchDiff(baseline, current) {
    const el = document.getElementById('benchDiffTable');
    const comparisons = current.benchmarks.map(cb => {
        const pb = baseline.benchmarks.find(b => b.name === cb.name && b.scale === cb.scale);
        const baseMs = pb ? pb.median_ms : null;
        const pctChange = (baseMs && cb.median_ms) ? ((cb.median_ms - baseMs) / baseMs) * 100 : null;
        const speedup = (baseMs && cb.median_ms > 0) ? baseMs / cb.median_ms : null;
        return { name: cb.name, module: cb.module, scale: cb.scale, baseMs, currMs: cb.median_ms, pctChange, speedup };
    }).sort((a, b) => (b.speedup || 0) - (a.speedup || 0));

    function renderRows(items) {
        return items.map(c => {
            let rc = '';
            if (c.pctChange != null) { if (c.pctChange < -5) rc = 'row-improved'; else if (c.pctChange > 5) rc = 'row-regression'; }
            return `<tr class="${rc}"><td>${c.name}</td><td style="font-family:var(--font-sans)">${c.module}</td><td>${c.scale}</td><td>${fmtMs(c.baseMs)}</td><td>${fmtMs(c.currMs)}</td><td>${fmtPct(c.pctChange)}</td><td>${speedupBadge(c.speedup)}</td></tr>`;
        }).join('');
    }

    let html = '<table><thead><tr><th data-col="0">Component</th><th data-col="1">Module</th><th data-col="2">Scale</th><th data-col="3">Baseline (ms)</th><th data-col="4">Current (ms)</th><th data-col="5">Change</th><th data-col="6">Speedup</th></tr></thead><tbody>';
    html += renderRows(comparisons) + '</tbody></table>';
    el.innerHTML = html;

    // Sortable headers
    const keys = ['name', 'module', 'scale', 'baseMs', 'currMs', 'pctChange', 'speedup'];
    let sortAsc = true;
    el.querySelectorAll('th').forEach(th => {
        th.addEventListener('click', () => {
            const col = +th.dataset.col;
            const key = keys[col];
            comparisons.sort((a, b) => {
                const av = a[key], bv = b[key];
                if (av == null && bv == null) return 0;
                if (av == null) return 1; if (bv == null) return -1;
                return sortAsc ? (av < bv ? -1 : av > bv ? 1 : 0) : (bv < av ? -1 : bv > av ? 1 : 0);
            });
            sortAsc = !sortAsc;
            el.querySelector('tbody').innerHTML = renderRows(comparisons);
        });
    });
}

function renderSpeedupChart(baseline, current) {
    const el = document.getElementById('chartSpeedup');
    if (!el) return;
    const items = [];
    current.benchmarks.forEach(cb => {
        const pb = baseline.benchmarks.find(b => b.name === cb.name && b.scale === cb.scale);
        if (pb && pb.median_ms > 0 && cb.median_ms > 0) {
            items.push({ name: `${cb.name} [${cb.scale}]`, pctChange: ((cb.median_ms - pb.median_ms) / pb.median_ms) * 100 });
        }
    });
    items.sort((a, b) => a.pctChange - b.pctChange);

    Plotly.newPlot(el, [{
        type: 'bar', orientation: 'h',
        y: items.map(i => i.name), x: items.map(i => i.pctChange),
        marker: { color: items.map(i => i.pctChange < 0 ? '#3fb950' : '#f85149') },
        hovertemplate: '%{y}<br>%{x:.1f}%<extra></extra>',
    }], plotlyLayout({
        xaxis: { title: 'Change (%)', zeroline: true, zerolinewidth: 2, zerolinecolor: isDark() ? '#e6edf3' : '#1f2328' },
        yaxis: { automargin: true }, margin: { l: 200 }, showlegend: false,
    }), plotlyConfig());
}

function renderCompareSummary(baseline, current) {
    const el = document.getElementById('compareSummaryGrid');
    if (!el) return;
    const speedups = [];
    current.benchmarks.forEach(cb => {
        const pb = baseline.benchmarks.find(b => b.name === cb.name && b.scale === cb.scale);
        if (pb && pb.median_ms > 0 && cb.median_ms > 0) speedups.push({ name: cb.name, scale: cb.scale, speedup: pb.median_ms / cb.median_ms });
    });
    if (!speedups.length) { el.innerHTML = '<p style="color:var(--text-muted)">No overlapping benchmarks to compare.</p>'; return; }

    const gm = geomean(speedups.map(s => s.speedup));
    const improved = speedups.filter(s => s.speedup > 1.05);
    const regressed = speedups.filter(s => s.speedup < 0.95);
    const best = speedups.reduce((a, b) => a.speedup > b.speedup ? a : b);
    const worst = speedups.reduce((a, b) => a.speedup < b.speedup ? a : b);

    el.innerHTML = `
        <div class="summary-card"><div class="summary-card-title">Geometric Mean</div><div class="summary-card-value">${speedupBadge(gm)}</div></div>
        <div class="summary-card"><div class="summary-card-title">Improvements</div><div class="summary-card-value" style="color:var(--green)">${improved.length}</div><div class="summary-card-detail">of ${speedups.length} benchmarks</div></div>
        <div class="summary-card"><div class="summary-card-title">Regressions</div><div class="summary-card-value" style="color:var(--red)">${regressed.length}</div><div class="summary-card-detail">of ${speedups.length} benchmarks</div></div>
        <div class="summary-card"><div class="summary-card-title">Largest Improvement</div><div class="summary-card-value">${fmtSpeedup(best.speedup)}</div><div class="summary-card-detail">${best.name} [${best.scale}]</div></div>
        <div class="summary-card"><div class="summary-card-title">Largest Regression</div><div class="summary-card-value">${fmtSpeedup(worst.speedup)}</div><div class="summary-card-detail">${worst.name} [${worst.scale}]</div></div>`;
}
