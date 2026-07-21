import type { Metadata } from "next";
import { ContentPage } from "@/components/site/ContentPage";
import { PAGES } from "@/lib/siteContent";
export function generateMetadata(): Metadata { const p = PAGES["size-guide"]; return { title: p.title, description: p.intro }; }
export default function Page() { return <ContentPage k="size-guide" />; }
