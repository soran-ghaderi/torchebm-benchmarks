# TorchEBM Benchmarks

Performance benchmarks dashboard for [TorchEBM](https://github.com/soran-ghaderi/torchebm) — a PyTorch library for Energy-Based Models.

**[Live Dashboard](https://soran-ghaderi.github.io/torchebm-benchmarks/)**

## Pages

- **Dashboard** — Latest benchmark results: timing, throughput, GPU memory, scaling
- **History** — Performance trends and speedup heatmaps across versions
- **Compare** — Side-by-side diff of any two benchmark runs

## Usage

```bash
# Serve locally
python -m http.server 8000

# Regenerate manifest from existing results
bash scripts/publish.sh

# Publish a new result
bash scripts/publish.sh path/to/result.json Linux-CPython-3.10-64bit

# Publish and push to GitHub
bash scripts/publish.sh path/to/result.json Linux-CPython-3.10-64bit --push
```

## License

MIT
