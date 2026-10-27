import { AbasComercial } from "@/components/central/Comercial";

export default function LayoutComercial({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <AbasComercial />
      {children}
    </div>
  );
}
