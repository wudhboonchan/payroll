import { useOutletContext } from 'react-router-dom'
import { TopBarV2 } from '../../components/v2/layout/TopBarV2'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAppStore } from '../../store/useAppStore'
import { useState } from 'react'
import { Download } from 'lucide-react'
import '../../styles/v2-tokens.css'

export default function ExportV2() {
  const { onMenuClick } = useOutletContext<{ onMenuClick: () => void }>()

  return (
    <div className="vk-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBarV2 title="ส่งออกข้อมูล" onMenuClick={onMenuClick} />

      <div style={{ padding: '28px 36px 60px' }}>
        <div className="vk-eyebrow" style={{ marginBottom: 4 }}>EXPORT · ส่งออกข้อมูล</div>
        <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em', marginBottom: 28 }}>ดาวน์โหลดไฟล์</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, border: '1px solid var(--vk-rule)' }}>
          {[
            { title: 'ตาราง Payroll รวม',     desc: 'ดาวน์โหลดข้อมูล Payroll ทุกคนในรูปแบบ .xlsx',                      label: 'Download Excel', color: 'var(--vk-jade)' },
            { title: 'PDF – Pay Slip รายบุคคล',desc: 'สร้างไฟล์ PDF Pay Slip แยกตามรายชื่อพนักงาน หรือพิมพ์ทั้งบริษัท', label: 'Download PDF',   color: 'var(--vk-crimson)' },
            { title: 'ฟอร์มประกันสังคม',      desc: 'Export ข้อมูลเลขบัตร + ยอดประกันสังคม สำหรับยื่น สปส. รายเดือน', label: 'Download Excel', color: 'var(--vk-marigold)' },
          ].map((card, i) => (
            <div key={i} style={{ background: 'var(--vk-bone)', borderRight: i < 2 ? '1px solid var(--vk-rule)' : 'none', padding: '28px 24px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ width: 36, height: 36, background: 'var(--vk-paper-2)', border: '1px solid var(--vk-rule-soft)', borderRadius: 4, display: 'grid', placeItems: 'center', marginBottom: 16, flexShrink: 0 }}>
                <Download style={{ width: 16, height: 16, color: card.color }} />
              </div>
              <div style={{ fontFamily: 'var(--vk-sans)', fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em', marginBottom: 8 }}>{card.title}</div>
              <div className="vk-small" style={{ color: 'var(--vk-ink-3)', flex: 1, lineHeight: 1.5, fontSize: 13 }}>{card.desc}</div>
              <button className="vk-btn" style={{ marginTop: 20, borderColor: card.color, color: card.color }}
                onClick={() => document.getElementById('export-v1')?.click()}>
                <Download style={{ width: 13, height: 13 }} /> {card.label}
              </button>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 32, padding: '20px 24px', background: 'var(--vk-bone)', border: '1px solid var(--vk-rule)' }}>
          <div className="vk-eyebrow" style={{ marginBottom: 8 }}>หมายเหตุ</div>
          <div className="vk-small" style={{ color: 'var(--vk-ink-3)' }}>
            ฟังก์ชัน Export ใช้ระบบเดียวกับ V1 — กด Download แล้วระบบจะ redirect ไปหน้า Export เพื่อดำเนินการต่อ
          </div>
          <a id="export-v1" href="/export" style={{ display: 'none' }} />
        </div>
      </div>
    </div>
  )
}
