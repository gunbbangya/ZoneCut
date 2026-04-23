import { PhotoUpload } from "@/components/PhotoUpload";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-black text-zinc-100">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-4 sm:px-6">
        <h1 className="text-center text-xl font-semibold tracking-tight text-white sm:text-2xl">
          ZoneCut
        </h1>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-6 sm:px-6">
        <PhotoUpload className="w-full" />
      </main>
    </div>
  );
}
