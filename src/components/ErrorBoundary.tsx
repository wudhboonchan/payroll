import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React component tree:', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleGoHome = () => {
    window.location.href = '/dashboard'
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F4F0E6',
          padding: '24px',
          fontFamily: "'Plus Jakarta Sans', 'Anuphan', sans-serif"
        }}>
          <div style={{
            maxWidth: '560px',
            width: '100%',
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.03)',
            border: '1px solid #EFDCD0',
            padding: '32px',
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              backgroundColor: '#FEF2F2',
              border: '1px solid #FCA5A5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#B91C1C',
              fontSize: '24px',
              marginBottom: '16px'
            }}>
              ⚠️
            </div>

            <h2 style={{
              fontSize: '20px',
              fontWeight: 700,
              color: '#1E293B',
              margin: '0 0 8px 0',
              lineHeight: 1.3
            }}>
              เกิดข้อผิดพลาดในการแสดงผล
            </h2>

            <p style={{
              fontSize: '14px',
              color: '#64748B',
              margin: '0 0 20px 0',
              lineHeight: 1.5
            }}>
              ระบบตรวจพบข้อผิดพลาดที่ไม่สามารถประมวลผลหน้าจอได้ กรุณาลองรีเฟรชหน้าจอใหม่อีกครั้ง หรือกลับไปที่หน้าหลัก
            </p>

            {this.state.error && (
              <div style={{
                backgroundColor: '#FFFBEB',
                border: '1px solid #FDE68A',
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '20px',
                fontSize: '12px',
                color: '#92400E',
                fontFamily: 'monospace',
                wordBreak: 'break-word',
                maxHeight: '160px',
                overflowY: 'auto'
              }}>
                <strong>ข้อความข้อผิดพลาด:</strong>
                <div style={{ marginTop: '4px' }}>
                  {this.state.error.name}: {this.state.error.message}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={this.handleReload}
                style={{
                  flex: 1,
                  minWidth: '130px',
                  padding: '10px 18px',
                  backgroundColor: '#B14729',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'opacity 150ms',
                }}
                onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
                onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
              >
                🔄 รีเฟรชหน้านี้ใหม่
              </button>

              <button
                onClick={this.handleGoHome}
                style={{
                  flex: 1,
                  minWidth: '130px',
                  padding: '10px 18px',
                  backgroundColor: '#F1F5F9',
                  color: '#334155',
                  border: '1px solid #CBD5E1',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🏠 กลับหน้าหลัก
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
