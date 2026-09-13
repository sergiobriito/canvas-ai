const LOCAL_SERVER_URL = "http://127.0.0.1:8000";
const API_KEY = "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";
const MODEL = "nex-agi/nex-n2.5-pro:free";

function getCanvasScreenshot() {
    const canvas = document.getElementById('canvas');
    const scale = 0.5;
    const smallCanvas = document.createElement('canvas');

    smallCanvas.width = Math.round(canvas.width * scale);
    smallCanvas.height = Math.round(canvas.height * scale);

    const smallCtx = smallCanvas.getContext('2d');

    smallCtx.drawImage(
        canvas,
        0,
        0,
        smallCanvas.width,
        smallCanvas.height
    );

    const imageData = smallCanvas.toDataURL("image/jpeg", 0.7);
    
    return imageData.replace(/^data:image\/jpeg;base64,/, "");
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

function executeInstructions(code) {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const action = new Function("ctx", code);
    action(ctx);
}

async function callLLM(prompt, image) {
    const response = await fetch(LOCAL_SERVER_URL, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            "model": MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": `data:image/jpeg;base64,${image}`
                            }
                        }
                    ]
                }
            ],
            "temperature": 0,
            "response_format": {
                "type": "json_object"
            }
        })
    });

    if (!response.ok) {
        throw new Error(response);
    }

    const data = await response.json();
    const raw_content = data.choices[0].message.content;     
    const parsed = JSON.parse(raw_content);

    return [parsed.done, parsed.instruction];
}

async function main() {
    const input = "Draw a red circle";
    let prompt = await getPrompt(input);

    console.log("Prompt: ", prompt);

    let [done, instruction] = await callLLM(prompt, getCanvasScreenshot());

    let number_of_iterations = 0;

    // Agentic Loop
    while (!done) {
        number_of_iterations++;

        console.log("Interaction: ", number_of_iterations);
        console.log("Done: ", done);
        console.log("Instruction: ", instruction);

        executeInstructions(instruction);

        await new Promise(resolve => setTimeout(resolve, 1000));

        [done, instruction] = await callLLM(prompt, getCanvasScreenshot());
    }

    console.log("Agentic loop completed.");
}

main();
