const crypto = require("crypto");
const express = require("express");

const app = express();
const PORT = 5500;

app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

const jobs = new Map();

app.post("/api/generate", async (req, res) => {
    const jobId = crypto.randomUUID();

    jobs.set(jobId, {
        status: "pending",
        result: null,
        error: null
    });

    res.json({ jobId });

    try {
        console.log(`[${jobId}] Sending request to Ollama...`);

        const response = await fetch("http://127.0.0.1:11434/api/generate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                ...req.body,
                stream: true
            })
        });

        console.log(`[${jobId}] Ollama status:`, response.status);

        if (!response.ok) {
            const errorText = await response.text();

            jobs.set(jobId, {
                status: "error",
                result: null,
                error: errorText
            });

            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";
        let result = "";

        while (true) {
            const { value, done } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;

                const chunk = JSON.parse(line);

                if (chunk.response) {
                    result += chunk.response;
                }
            }
        }

        if (buffer.trim()) {
            const chunk = JSON.parse(buffer);

            if (chunk.response) {
                result += chunk.response;
            }
        }

        console.log(`[${jobId}] Ollama stream completed.`);
        console.log(`[${jobId}] Result:`, result);

        jobs.set(jobId, {
            status: "completed",
            result,
            error: null
        });

    } catch (error) {
        console.error(`[${jobId}] Ollama error:`, error);

        jobs.set(jobId, {
            status: "error",
            result: null,
            error: error.message
        });
    }
});

app.get("/api/generate/:jobId", (req, res) => {
    const job = jobs.get(req.params.jobId);

    if (!job) {
        return res.status(404).json({
            error: "Job not found"
        });
    }

    res.json(job);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
