import { GameLoop } from "./GameLoop";
import CgolComp from "../shaders/CgolComp.wgsl?raw";
import CellShader from "../shaders/CellShader.wgsl?raw";

interface WebGPUPayload {
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  device: GPUDevice,
}

async function initWebGPU(): Promise<WebGPUPayload> {
  const canvas = document.querySelector("canvas");

  if (!canvas) {
    return Promise.reject("Canvas not present.");
  }

  if (!navigator.gpu) {
    return Promise.reject("WebGPU not supported on this browser.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return Promise.reject("No appropriate GPUAdapter found.");
  }
  
  // once we get the device the adapter gets invalidated
  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  if (!context) {
    return Promise.reject("Context failed to be initialized");
  }

  return {
    device,
    canvas,
    context,
  }
}

const GRID_SIZE = 32;

function runGameOfLife(wgpu: WebGPUPayload) {
  const {device, context} = wgpu;

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
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

  // set an initial state into buffer
  for (let i = 0; i < cellStateArray.length; ++i) {
    cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
  }

  device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);
  device.queue.writeBuffer(cellStateStorage[1], 0, cellStateArray);

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
    code: CellShader
  });

  const WORKGROUP_SIZE = 8;

  const simulationShaderModule = device.createShaderModule({
    label: "Game of Life simulation shader",
    code: CgolComp.replaceAll("WORKGROUP_SIZE", WORKGROUP_SIZE.toString())
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
      buffer: { type: "uniform" } // when empty uniform is default
    }, {
      binding: 1,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
      buffer: { type: "read-only-storage" }
    }, {
      binding: 2,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: "storage" },
      // other option keys: texture and sampler
    }]
  });

  const bindGroups = [
    device.createBindGroup({
      label: "Cell renderer bind group A",
      layout: bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: uniformBuffer }
      },
      {
        binding: 1,
        resource: { buffer: cellStateStorage[0] }
      }, {
        binding: 2,
        resource: { buffer: cellStateStorage[1] }
      }],
    }),
    device.createBindGroup({
      label: "Cell renderer bind group B",
      layout: bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: uniformBuffer }
      },
      {
        binding: 1,
        resource: { buffer: cellStateStorage[1] }
      }, {
        binding: 2,
        resource: { buffer: cellStateStorage[0] }
      }],
    }),
  ];

  const pipelineLayout = device.createPipelineLayout({
    label: "Cell Pipeline Layout",
    bindGroupLayouts: [ bindGroupLayout ],
  });

  const cellPipeline = device.createRenderPipeline({
    label: "Cell pipeline",
    layout: pipelineLayout,
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
  const simulationPipeline = device.createComputePipeline({
    label: "Simulation pipeline",
    layout: pipelineLayout,
    compute: {
      module: simulationShaderModule,
      entryPoint: "computeMain",
    }
  });

  context.configure({
    device: device,
    format: canvasFormat
  });

  const UPDATE_INTERVAL = 40;
  const FPS = 1000 / UPDATE_INTERVAL;
  let step = 0;

  const game = new GameLoop(FPS, (): void => updateGrid(context));
  game.runLoop();

  function updateGrid(context: GPUCanvasContext) {
    const encoder = device.createCommandEncoder();
    const computePass = encoder.beginComputePass();
  
    computePass.setPipeline(simulationPipeline);
    computePass.setBindGroup(0, bindGroups[step % 2]);
  
    const workgroupCount = Math.ceil(GRID_SIZE / WORKGROUP_SIZE);
    computePass.dispatchWorkgroups(workgroupCount, workgroupCount);
  
    computePass.end();
  
    ++step;
  
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
    pass.setBindGroup(0, bindGroups[step % 2]);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(vertices.length / 2, GRID_SIZE * GRID_SIZE);
  
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
}

export { initWebGPU, runGameOfLife };
