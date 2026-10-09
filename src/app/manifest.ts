import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stride — study like you train",
    short_name: "Stride",
    description: "Training plans and a social feed for studying.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0c0e",
    theme_color: "#fc4c02",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
