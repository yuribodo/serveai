import { ServeAIApp } from "@/components/serveai-app";

type AppPageProps = {
  searchParams: Promise<{ prompt?: string | string[] }>;
};

export default async function AppPage({ searchParams }: AppPageProps) {
  const params = await searchParams;
  const prompt = Array.isArray(params.prompt) ? params.prompt[0] : params.prompt;

  return <ServeAIApp initialMessage={prompt?.slice(0, 500) ?? ""} />;
}
