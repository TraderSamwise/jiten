// esbuild's dataurl loader turns these imports into inlined `data:` URI strings.
declare module "*.png" {
  const src: string;
  export default src;
}
