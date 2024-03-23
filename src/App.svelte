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

    // naive triangle
    const vertices = new Float32Array([
    //   X,    Y,
      -0.8, -0.8, // triangle 1 (Blue)
       0.8, -0.8,
       0.8,  0.8,

       0.8,  0.8, // triangle 2 (Red)
      -0.8,  0.8,
      -0.8, -0.8,
    ]);
    
    const vertexBuffer = device.createBuffer({
      label: "Cell Vertices",
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, vertices);

    const vertexBufferLayout: GPUVertexBufferLayout = {
      arrayStride: 8,
      attributes: [{
        format: "float32x2",
        offset: 0,
        shaderLocation: 0, // Position, see vertex shader
      }]
    };

    const cellShaderModule = device.createShaderModule({
      label: "Cell Shader",
      code: `
        @vertex
        fn vertexMain(@location(0) pos: vec2f) ->
        @builtin(position) vec4f {
          return vec4f(pos, 0, 1); // ((X, Y), Z, W)
        }

        @fragment
        fn fragmentMain() -> @location(0) vec4f {
          return vec4f(1, 0, 0, 1); // (Red, Green, Blue, Alpha)
        }
      `
    });

    const cellPipeline = device.createRenderPipeline({
      label: "Cell pipeline",
      layout: "auto",
      vertex: {
        module: cellShaderModule,
        entryPoint: "vertexMain",
        buffers: [vertexBufferLayout],
      },
      fragment: {
        module: cellShaderModule,
        entryPoint: "fragmentMain",
        targets: [{
          format: canvasFormat,
        }],
      },
    });

    context.configure({
      device: device,
      format: canvasFormat
    });

    const encoder = device.createCommandEncoder();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: { r: 0, g:0, b:0.4, a: 0.8 },
        // clearValue: [0, 0, 0.4, 1], // equivalent
        storeOp: "store",
      }],
    });

    pass.setPipeline(cellPipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(vertices.length / 2);

    pass.end();

    device.queue.submit([encoder.finish()]);

  });
</script>

<main>
  <canvas width="512" height="512"></canvas>
</main>

