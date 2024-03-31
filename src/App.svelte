<script lang="ts">
  import { onMount } from "svelte";
  import { initWebGPU, runGameOfLife } from "./modules/CGoL";

  onMount(() => {
    initWebGPU()
      .then((wgpu) => {
        runGameOfLife(wgpu);
      })
      .catch((err) => {
        throw new Error(err);
      });
  });
</script>

<main>
  <canvas width="512" height="512"></canvas>
</main>
