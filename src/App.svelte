<script lang="ts">
  import { onMount } from "svelte";

  onMount(async () => {
    const GRID_SIZE = 32;
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

    const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
    const uniformBuffer = device.createBuffer({
      label: "Grid Uniforms",
      size: uniformArray.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

    // Create an array representing th active state of each cell
    const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE);
    // Create a storage buffer to hold the cell state.
    const cellStateStorage = [
      device.createBuffer({
        label: "Cell State A",
        size: cellStateArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
      device.createBuffer({
        label: "Cell State B",
        size: cellStateArray.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    ];
    for (let i = 0; i < cellStateArray.length; i += 3) {
      cellStateArray[i] = 1;
    }
    device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);
    for (let i = 0; i < cellStateArray.length; ++i) {
      cellStateArray[i] = i % 2;
    }
    device.queue.writeBuffer(cellStateStorage[1], 0, cellStateArray);

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
        struct VertexInput {
          @location(0) pos: vec2f,
          @builtin(instance_index) instance: u32,
        };

        struct VertexOutput {
          @builtin(position) pos: vec4f,
          @location(0) cell: vec2f,
        }

        @group(0) @binding(0) var<uniform> grid: vec2f;
        @group(0) @binding(1) var<storage> cellState: array<u32>;

        @vertex
        fn vertexMain(input: VertexInput) -> VertexOutput {
          let i = f32(input.instance);
          let cell = vec2f(i % grid.x, floor(i / grid.x));
          let state = f32(cellState[input.instance]);

          let cellOffset = cell / grid * 2;
          let gridPos = (input.pos * state + 1) / grid - 1 + cellOffset;

          var output: VertexOutput;
          output.pos = vec4f(gridPos, 0, 1);
          output.cell = cell;
          return output;
        }

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
          let c: vec2f = input.cell / grid;
          return vec4f(c, 1 - c.x, 1); // (Red, Green, Blue, Alpha)
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

    const bindGroup = [
      device.createBindGroup({
        label: "Cell renderer bind group A",
        layout: cellPipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: { buffer: uniformBuffer }
        },
        {
          binding: 1,
          resource: { buffer: cellStateStorage[0] }
        }],
      }),
      device.createBindGroup({
        label: "Cell renderer bind group B",
        layout: cellPipeline.getBindGroupLayout(0),
        entries: [{
          binding: 0,
          resource: { buffer: uniformBuffer }
        },
        {
          binding: 1,
          resource: { buffer: cellStateStorage[1] }
        }],
      }),
    ];

    context.configure({
      device: device,
      format: canvasFormat
    });
    
    const UPDATE_INTERVAL = 200;
    let step = 0;

    // use a proper game loop
    // reference: https://stackoverflow.com/a/19772220

    class GameLoop {
      fps: number;
      fpsInterval: number;
      drawCall: Function;
      timeOffset: number;
      frameOffset: number;
      time: number;
      timeInFrame: number;
      timeDelta: number;

      constructor(fps: number, drawCall: Function) {
        this.timeOffset = Date.now();
        this.frameOffset = 0;
        this.fps = fps;
        this.fpsInterval = 1000 / fps;
        this.drawCall = drawCall;
        this.time = 0;
        this.timeInFrame = 0;
        this.timeDelta = 0;
      }

      runLoop() {
        requestAnimationFrame(() => this.runLoop());

        const now = Date.now();
        const newTime = now - this.timeOffset;
        this.timeDelta = newTime - this.time;
        this.time = newTime;
        this.timeInFrame = now - this.frameOffset;

        if (this.timeInFrame > this.fpsInterval) {
          this.frameOffset = now - (this.timeInFrame % this.fpsInterval);

          this.drawCall();
        }
      }
    }

    const game = new GameLoop(5, (): void => updateGrid(context));
    game.runLoop();
    
    function updateGrid(context: GPUCanvasContext) {
      ++step;

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
      pass.setBindGroup(0, bindGroup[step % 2]);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.draw(vertices.length / 2, GRID_SIZE * GRID_SIZE);
    
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
  });
</script>

<main>
  <canvas width="512" height="512"></canvas>
</main>

