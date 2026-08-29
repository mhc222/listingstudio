// Marzipano ships no types; we touch a handful of APIs through `any`.
declare module "marzipano" {
  const Marzipano: Record<string, any>
  export default Marzipano
}
