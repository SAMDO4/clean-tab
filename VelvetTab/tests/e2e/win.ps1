param([string]$Action,[int]$ProcId,[string]$Out,[string]$Keys)
Add-Type -AssemblyName System.Drawing,System.Windows.Forms
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;
public class W{
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint f);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")]public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);
 public struct RECT{public int L,T,R,B;}
 public static IntPtr Find(uint pid){IntPtr best=IntPtr.Zero;int area=0;EnumWindows((h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid&&IsWindowVisible(h)){var sb=new StringBuilder(64);GetClassName(h,sb,64);if(sb.ToString().StartsWith("Chrome_WidgetWin")){RECT r;GetWindowRect(h,out r);int a=(r.R-r.L)*(r.B-r.T);if(a>area){area=a;best=h;}}}return true;},IntPtr.Zero);return best;}
}
"@
[void][W]::SetProcessDPIAware()
$h=[W]::Find([uint32]$ProcId)
if($h -eq [IntPtr]::Zero){Write-Output "NOWINDOW";exit 1}
if($Action -eq 'shot'){
 $r=New-Object W+RECT;[void][W]::GetWindowRect($h,[ref]$r)
 $bmp=New-Object System.Drawing.Bitmap ($r.R-$r.L),($r.B-$r.T)
 $g=[System.Drawing.Graphics]::FromImage($bmp);$dc=$g.GetHdc();[void][W]::PrintWindow($h,$dc,2);$g.ReleaseHdc($dc)
 $bmp.Save($Out,[System.Drawing.Imaging.ImageFormat]::Png);Write-Output "OK $($r.R-$r.L)x$($r.B-$r.T)"
}elseif($Action -eq 'keys'){
 [W]::keybd_event(0x12,0,0,[UIntPtr]::Zero);[W]::keybd_event(0x12,0,2,[UIntPtr]::Zero) # ALT tap lets SetForegroundWindow succeed
 [void][W]::ShowWindow($h,9);$ok=[W]::SetForegroundWindow($h);Start-Sleep -Milliseconds 300
 if([W]::GetForegroundWindow() -ne $h){Write-Output "NOTFOREGROUND";exit 2}
 [System.Windows.Forms.SendKeys]::SendWait($Keys);Write-Output "SENT fg=$ok"
}
