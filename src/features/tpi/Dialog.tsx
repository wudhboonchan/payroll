import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
export function TpiDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
 const ref=useRef<HTMLDialogElement>(null)
 useEffect(()=>{ref.current?.showModal()},[])
 return <dialog ref={ref} className="tpi-dialog vk-root" aria-label={title} onCancel={onClose} onClose={onClose}>
  <header><h2>{title}</h2><button type="button" aria-label="ปิดหน้าต่าง" onClick={onClose}><X size={18}/></button></header>{children}
 </dialog>
}
