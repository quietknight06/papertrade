const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");


const execFileAsync = promisify(execFile);
const CACHE_LIFETIME_MS = 10 * 60 * 1000;


function findPython(mlRoot) {
  const candidates = [
    process.env.ML_PYTHON_PATH,
    path.join(mlRoot, ".venv", "Scripts", "python.exe"),
    path.join(mlRoot, ".venv", "bin", "python"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "python";
}


function createPredictionService() {
  const mlRoot = path.resolve(__dirname, "../ml");
  const scriptPath = path.join(mlRoot, "src", "dashboard_predictions.py");
  const pythonPath = findPython(mlRoot);
  const cache = new Map();
  const inFlight = new Map();

  async function runPrediction(ticker) {
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Prediction script not found at ${scriptPath}`);
    }

    const { stdout } = await execFileAsync(
      pythonPath,
      [scriptPath, "--ticker", ticker],
      {
        cwd: mlRoot,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120000,
        windowsHide: true,
      },
    );
    return JSON.parse(stdout);
  }

  async function getPrediction(ticker) {
    const cached = cache.get(ticker);
    if (cached && Date.now() - cached.createdAt < CACHE_LIFETIME_MS) {
      return cached.value;
    }
    if (inFlight.has(ticker)) return inFlight.get(ticker);

    const request = runPrediction(ticker)
      .then((value) => {
        cache.set(ticker, { createdAt: Date.now(), value });
        return value;
      })
      .finally(() => inFlight.delete(ticker));
    inFlight.set(ticker, request);
    return request;
  }

  return { getPrediction };
}


module.exports = { createPredictionService };
