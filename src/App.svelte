<script lang="ts">
  import { onMount } from "svelte";

  onMount(async () => {
    const canvas = document.querySelector("canvas");

    if (!canvas) {
      throw new Error("Canvas not present.");
    }

    if (!navigator.gpu) {
      throw new Error("WebGPU not supported on this browser.");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No appropriate GPUAdapter found.");
    }

    const device = await adapter.requestDevice();

    const context = canvas.getContext("webgpu");
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    if (!context) {
      throw new Error("Context failed to be initialized");
    }

    context.configure({
      device: device,
      format: canvasFormat
    });

    const encoder = device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: { r: 0, g:0, b:0.4, a: 1 },
        // clearValue: [0, 0, 0.4, 1], // equivalent
        storeOp: "store",
      }],
    });

    pass.end();

    device.queue.submit([encoder.finish()]);

  });
</script>

<main>
  <canvas width="512" height="512"></canvas>
</main>

