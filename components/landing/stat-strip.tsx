import { Stat } from "@/components/ui/stat";

const STATS = [
  { value: 300, prefix: "<", suffix: "ms", label: "Response latency" },
  { value: 20, label: "Languages supported" },
  { value: 0, label: "Data ever sold" },
] as const;

/** Three proof metrics separated by hairlines. */
export function StatStrip() {
  return (
    <section
      aria-label="Elara by the numbers"
      className="relative border-y border-border bg-card/40"
    >
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-6 py-14 sm:grid-cols-3 sm:gap-6">
        {STATS.map((stat) => (
          <Stat
            key={stat.label}
            value={stat.value}
            label={stat.label}
            prefix={"prefix" in stat ? stat.prefix : undefined}
            suffix={"suffix" in stat ? stat.suffix : undefined}
          />
        ))}
      </div>
    </section>
  );
}
