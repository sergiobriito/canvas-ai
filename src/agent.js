const LOCAL_SERVER_URL = "http://127.0.0.1:8000";
const API_KEY = "";
const MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const MAX_INTERACTIONS = 50;

export class CanvasAgent {
    constructor(canvas) {
        this.canvas = canvas;
    }

    log(message, details = null) {
        if (details === null) {
            console.log(`[CanvasAgent] ${message}`);
            return;
        }

        console.log(`[CanvasAgent] ${message}`, details);
    }

    async loadPrompt(templateName, replacements) {
        const response = await fetch(templateName);

        if (!response.ok) {
            throw new Error(
                `Failed to load prompt: ${templateName}`
            );
        }

        const promptTemplate = await response.text();

        return Object.entries(replacements).reduce(
            (prompt, [placeholder, value]) => {
                const escapedPlaceholder =
                    placeholder.replace(
                        /[.*+?^${}()|[\]\\]/g,
                        "\\$&"
                    );

                return prompt.replace(
                    new RegExp(
                        `\\{${escapedPlaceholder}\\}`,
                        "g"
                    ),
                    String(value)
                );
            },
            promptTemplate
        );
    }

    async buildPlanningPrompt(userRequest) {
        return this.loadPrompt(
            "prompts/planningPrompt.md", {
            input: userRequest,
            canvasWidth: this.canvas.width,
            canvasHeight: this.canvas.height
        }
        );
    }

    async buildDrawingPrompt(userRequest, state, component) {
        return this.loadPrompt(
            "prompts/drawingPrompt.md", {
            input: userRequest,
            canvasWidth: this.canvas.width,
            canvasHeight: this.canvas.height,

            visualStyle: JSON.stringify(
                state.visualStyle,
                null,
                2
            ),

            plan: JSON.stringify(
                state.plan,
                null,
                2
            ),

            state: JSON.stringify(
                state.agentContext,
                null,
                2
            ),

            component: JSON.stringify(
                component,
                null,
                2
            )
        }
        );
    }

    async executeInstructions(code) {
        const ctx = this.canvas.getContext("2d");

        try {
            const action = new Function(
                "ctx",
                `
                return (async () => {
                    ${code}
                })();
                `
            );

            await action(ctx);

            return {
                success: true,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async callLLM(prompt) {
        const response = await fetch(
            LOCAL_SERVER_URL, {
            method: "POST",

            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                model: MODEL,

                messages: [{
                    role: "user",
                    content: prompt
                }],

                temperature: 0,

                response_format: {
                    type: "json_object"
                }
            })
        }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                JSON.stringify(data)
            );
        }

        const content =
            data?.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error(
                "LLM returned no content."
            );
        }

        try {
            return JSON.parse(content);
        } catch {
            throw new Error(
                "LLM returned invalid JSON."
            );
        }
    }

    async createDrawingPlan(userRequest) {
        const planningPrompt =
            await this.buildPlanningPrompt(
                userRequest
            );

        const planningResult =
            await this.callLLM(
                planningPrompt
            );

        if (
            !planningResult.visualStyle ||
            !Array.isArray(
                planningResult.plan
            ) ||
            planningResult.plan.length === 0
        ) {
            throw new Error(
                "Planning response must contain visualStyle and plan."
            );
        }

        return {
            visualStyle: planningResult.visualStyle,

            plan: planningResult.plan.map(
                item => ({
                    ...item,
                    status: "pending"
                })
            ),

            components: []
        };
    }

    getNextPendingComponent(state) {
        return state.plan
            .filter(
                item =>
                    item.status === "pending"
            )
            .sort(
                (a, b) =>
                    a.zIndex - b.zIndex
            )[0];
    }

    async run(userRequest) {
        this.log("Agent started");
        this.log("User request: ", userRequest);

        const state = await this.createDrawingPlan(userRequest);
        const totalComponents = state.plan.length;

        this.log("Plan created: ", state.plan);

        let iteration = 0;

        state.agentContext = {
            iteration: 0,
            totalComponents,
            completedCount: 0,
            remainingCount: totalComponents,
            completedComponents: []
        };

        while (
            !state.plan.every(
                item =>
                    item.status === "complete"
            ) &&
            iteration < MAX_INTERACTIONS
        ) {
            iteration++;

            const component = this.getNextPendingComponent(state);

            if (!component) {
                break;
            }

            state.agentContext = {
                iteration,
                totalComponents,
                completedCount: state.components.length,
                remainingCount: totalComponents -
                    state.components.length,
                completedComponents: state.components.map(
                    item => item.name
                )
            };

            try {
                const drawingPrompt =
                    await this.buildDrawingPrompt(
                        userRequest,
                        state,
                        component
                    );

                const result =
                    await this.callLLM(
                        drawingPrompt
                    );

                if (
                    result.component !==
                    component.name ||
                    typeof result.instruction !==
                    "string"
                ) {
                    throw new Error(
                        "Invalid drawing response."
                    );
                }

                const execution =
                    await this.executeInstructions(
                        result.instruction
                    );

                if (!execution.success) {
                    throw new Error(
                        execution.error
                    );
                }

                component.status = "complete";

                state.components.push({
                    ...component,
                    status: "complete",
                    message: result.message || ""
                });

                const completed = state.components.length;
                const remaining = totalComponents - completed;

                this.log(
                    `Component completed: ${component.name}`, {
                    completed,
                    remaining,
                    iteration
                }
                );

            } catch (error) {
                this.log(error);
            }
        }

        const complete = state.plan.every(item => item.status === "complete");

        if (!complete) {
            throw new Error(
                `Drawing stopped after ${iteration} interactions. ` +
                `${state.components.length}/${totalComponents} components completed.`
            );
        }

        this.log("Agent finished");
    }
}