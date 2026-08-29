// Marzipano ships no types; we touch a handful of APIs through `any`.
declare module "marzipano" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Marzipano: Record<string, any>
  export default Marzipano
}
