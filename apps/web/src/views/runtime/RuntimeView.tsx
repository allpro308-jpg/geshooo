import { TerminalSquare } from "lucide-react";

import { Section } from "@/components/ui/Section";

export function RuntimePage() {
  return (
    <div>
      <div className="mb-7">
        <div className="text-[10px] font-semibold tracking-tighter2 text-accent">بيئة التشغيل</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tighter2 text-ink">الحاويات</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">سيتم ربط تنفيذ المشاريع المدعوم بدوكر هنا.</p>
      </div>
      <Section title="قائمة بيئة التشغيل">
        <div className="rounded-xl border border-hairline bg-surface p-6">
          <div className="flex items-center gap-3 text-sm font-medium text-ink">
            <span className="grid h-8 w-8 place-items-center rounded-md border border-line bg-elevated text-accent">
              <TerminalSquare size={15} />
            </span>
            تنسيق الحاويات جاهز للتنفيذ
          </div>
          <p className="mt-3 max-w-2xl text-sm text-muted">
            الحاوية الحالية تخدم المنصة نفسها. حاويات تشغيل المشاريع، وشبكات مساحات العمل المعزولة،
            وبثّ السجلات، وإعادة توجيه المعاينة هي وحدات الواجهة الخلفية التالية.
          </p>
        </div>
      </Section>
    </div>
  );
}
