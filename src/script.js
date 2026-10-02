import { CanvasAgent } from "./agent.js";

const canvas = document.getElementById("canvas");
const promptForm = document.getElementById("promptForm");
const userInput = document.getElementById("userInput");
const submitButton = promptForm.querySelector("button");
const status = document.getElementById("status");

const canvasAgent = new CanvasAgent(canvas, text => {
    status.textContent = text;
});

promptForm.addEventListener("submit", async event => {
    event.preventDefault();
    submitButton.disabled = true;

    try {
        await canvasAgent.run(userInput.value);
    } catch (error) {
        console.error(error);
        status.textContent = `Error: ${error.message}`;
    } finally {
        submitButton.disabled = false;
    }
});
