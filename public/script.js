const OLLAMA_URL = ""

function getCanvasScreenshot() {
    const canvas = document.getElementById('canvas');
    const imageData = canvas.toDataURL("image/png");
    return imageData.split(",")[1];
}

function getPrompt(input) {
    const canvas = document.getElementById('canvas');
    const canvas_width = canvas.width;
    const canvas_height = canvas.height;

    return fetch('prompt.md')
        .then(response => response.text())
        .then(prompt => {
            return prompt
                .replace('{input}', input)
                .replace('{canvas_width}', canvas_width)
                .replace('{canvas_height}', canvas_height);
        });
}

async function callLLM(prompt, base64Image) {
    const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "qwen2.5vl:7b",
            prompt,
            images: [base64Image],
            stream: true,
            format: {
                type: "object",
                properties: {
                    done: { type: "boolean" },
                    instruction: { type: "string" }
                },
                required: ["done", "instruction"]
            },
            options: {
                temperature: 0
            }
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to create Ollama job: HTTP ${response.status}`);
    }

    const { jobId } = await response.json();

    console.log("Created job:", jobId);

    while (true) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const jobResponse = await fetch(`/api/generate/${jobId}`);

        if (!jobResponse.ok) {
            throw new Error(`Job polling failed: HTTP ${jobResponse.status}`);
        }

        const job = await jobResponse.json();

        console.log("Job status:", job.status);

        if (job.status === "error") {
            throw new Error(`Ollama error: ${job.error}`);
        }

        if (job.status === "completed") {
            console.log("LLM raw response:", job.result);
            const parsed = JSON.parse(job.result);
            return [parsed.done, parsed.instruction];
        }
    }
}

function executeInstructions(codeString) {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const action = new Function("ctx", codeString);
    action(ctx);
}

async function agenticLoop() {
    const input = "Draw a simple house with a red roof, blue door, two windows, and a green tree next to it.";
    let prompt = await getPrompt(input);

    console.log("Prompt: ", prompt);

    let [done, instruction] = await callLLM(prompt, getCanvasScreenshot());

    let number_of_iterations = 0;

    while (!done) {
        number_of_iterations++;
        console.log("Interaction: ", number_of_iterations);

        console.log("Done: ", done);
        console.log("Instruction: ", instruction);

        executeInstructions(instruction);

        [done, instruction] = await callLLM(prompt, getCanvasScreenshot());
    }

    console.log("Agentic loop completed.");
}

agenticLoop();