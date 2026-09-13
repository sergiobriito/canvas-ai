let states = [];

function getPrompt(input) {
    const canvas = document.getElementById('canvas');
    const canvas_width = canvas.width;
    const canvas_height = canvas.height;
    const prompt = fetch('prompt.md').then(response => response.text());
    return Promise.all([prompt]).then(([prompt]) => {
        return prompt
            .replace('{input}', input)
            .replace('{states}', JSON.stringify(states))
            .replace('{canvas_width}', canvas_width)
            .replace('{canvas_height}', canvas_height);
    });
}

async function callLLM(input) {
    const model = 'llama3.1:8b';
    const prompt = await getPrompt(input);
    const output_schema = {
        type: "object",
        properties: {
            done: {
                type: "boolean"
            },
            message: {
                type: "string"
            },
            instruction: {
                type: "string"
            }
        },
        required: ["done", "message", "instruction"]
    };

    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                stream: false,
                format: output_schema,
                options: {
                    temperature: 0
                }
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const parsed = JSON.parse(data.response);

        console.log('Parsed data from LLM:', parsed);

        return [parsed.done, parsed.message, parsed.instruction];
    } catch (error) {
        console.error(error);
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
    console.log(`Starting agentic loop with input: "${input}"`);

    let [done, message, instructions] = await callLLM(input);

    let number_of_iterations = 0;
    while (!done) {
        console.log(`Iteration ${number_of_iterations + 1}: Executing instructions...`);
        number_of_iterations++;

        executeInstructions(instructions);

        states.push({message: message,instructions: instructions});

        [done, message, instructions] = await callLLM(input);
    }

    console.log("Agentic loop completed.");
}

agenticLoop();
