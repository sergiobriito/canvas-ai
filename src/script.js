const LOCAL_SERVER_URL = "http://127.0.0.1:8000";
const API_KEY = "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";
const MODEL = "nex-agi/nex-n2.5-pro:free";

function getPrompt(input, state) {
    const canvas = document.getElementById("canvas");

    return fetch("prompt.md")
        .then(response => response.text())
        .then(prompt => {
            return prompt
                .replace("{input}", input)
                .replace("{canvas_width}", canvas.width)
                .replace("{canvas_height}", canvas.height)
                .replace("{state}", JSON.stringify(state, null, 2));
        });
}

async function executeInstructions(code) {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");

    const action = new Function(
        "ctx",
        `
        return (async () => {
            ${code}
        })();
        `
    );

    await action(ctx);
}

async function callLLM(prompt) {
    const response = await fetch(LOCAL_SERVER_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0,
            response_format: {
                type: "json_object"
            }
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(JSON.stringify(data));
    }

    if (!data.choices || !data.choices[0]) {
        throw new Error(JSON.stringify(data));
    }

    const rawContent = data.choices[0].message.content;

    return JSON.parse(rawContent);
}

async function runAgent(input) {
    const state = {
        components: []
    };

    let done = false;
    let numberOfIterations = 0;

    while (!done) {
        numberOfIterations++;

        console.log("Interaction:", numberOfIterations);
        console.log("Current state:", JSON.stringify(state, null, 2));

        const prompt = await getPrompt(input, state);
        const result = await callLLM(prompt);

        console.log("Done:", result.done);
        console.log("Component:", result.component);
        console.log("Instruction:", result.instruction);

        await executeInstructions(result.instruction);

        state.components.push({
            name: result.component,
            status: "complete"
        });

        done = result.done;
    }

    console.log("Completed");
}

function clearCanvas() {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

const form = document.getElementById('promptForm');
const input = document.getElementById('userInput');

form.addEventListener('submit', function (event) {
    event.preventDefault();
    const value = input.value;
    clearCanvas();
    runAgent(value);
});
