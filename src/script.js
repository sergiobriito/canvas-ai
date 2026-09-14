import { CanvasAgent } from "./agent.js";

const canvas = document.getElementById("canvas");
const promptForm = document.getElementById("promptForm");
const userInput = document.getElementById("userInput");
const canvasAgent = new CanvasAgent(canvas);

function clearCanvas() {
    const canvasContext = canvas.getContext("2d");
    canvasContext.clearRect(0, 0, canvas.width, canvas.height);
}

promptForm.addEventListener("submit", async event => {
    event.preventDefault();
    clearCanvas();

    try {
        await canvasAgent.run(userInput.value);
    } catch (error) {
        console.error(error);
    }
});
