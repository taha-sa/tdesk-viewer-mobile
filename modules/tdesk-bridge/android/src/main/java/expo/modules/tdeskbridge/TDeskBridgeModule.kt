package expo.modules.tdeskbridge

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

private const val BRIDGE_PKG = "app.kopru"
private const val BRIDGE_SERVICE = "app.kopru.ViewerBridgeService"
private const val BRIDGE_SHARE = "app.kopru.ShareActivity"
private const val WHAT_SEND = 1
private const val WHAT_KEY = 2
private const val WHAT_RESULT = 100
private const val WHAT_PRESENT_STATE = 101

/**
 * T-Bridge köprüsü (yalnızca Android). Kanal: T-Bridge'in dışa açık ViewerBridgeService'i (Messenger); T-Bridge çağıranın UID'sinden
 * paket adını doğrular. Dosya, grantUriPermission ile T-Bridge'e okuma izni verilerek gönderilir.
 */
class TDeskBridgeModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "Uygulama bağlamı yok", null)

  private val main = Handler(Looper.getMainLooper())
  private var service: Messenger? = null
  private var connecting = false
  private val waiting = ArrayList<(Messenger?) -> Unit>()

  private val reply = Messenger(Handler(Looper.getMainLooper()) { msg ->
    if (msg.what == WHAT_PRESENT_STATE) {
      // Sunum durumu: state = "transferring" | "opened" | "failed" (eski T-Bridge bunu göndermez).
      val st = msg.data.getString("state") ?: ""
      sendEvent(
        "onBridgeResult",
        mapOf(
          "ok" to (st != "failed"),
          "message" to (msg.data.getString("msg") ?: ""),
          "connected" to msg.data.getBoolean("connected", true),
          "state" to st,
        ),
      )
    } else if (msg.what == WHAT_RESULT) {
      sendEvent(
        "onBridgeResult",
        mapOf(
          "ok" to msg.data.getBoolean("ok"),
          "message" to (msg.data.getString("msg") ?: ""),
          "connected" to msg.data.getBoolean("connected"),
        ),
      )
    }
    true
  })

  private val conn = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      service = Messenger(binder)
      connecting = false
      flush(service)
    }

    override fun onServiceDisconnected(name: ComponentName?) {
      service = null
    }

    override fun onNullBinding(name: ComponentName?) {
      connecting = false
      flush(null)
    }

    override fun onBindingDied(name: ComponentName?) {
      service = null
      connecting = false
      flush(null)
    }
  }

  private fun flush(m: Messenger?) {
    val cbs = ArrayList(waiting)
    waiting.clear()
    cbs.forEach { it(m) }
  }

  /** Servise bağlanır (gerekirse); 4 sn içinde bağlanamazsa null döner. */
  private fun withService(cb: (Messenger?) -> Unit) {
    service?.let { cb(it); return }
    waiting.add(cb)
    if (connecting) return
    connecting = true
    val ok = try {
      ctx.bindService(Intent().setComponent(ComponentName(BRIDGE_PKG, BRIDGE_SERVICE)), conn, Context.BIND_AUTO_CREATE)
    } catch (_: SecurityException) {
      false
    }
    if (!ok) {
      connecting = false
      flush(null)
      return
    }
    main.postDelayed({
      if (service == null && connecting) {
        connecting = false
        flush(null)
      }
    }, 4000)
  }

  private fun isInstalled(pkg: String): Boolean = try {
    ctx.packageManager.getPackageInfo(pkg, 0)
    true
  } catch (_: PackageManager.NameNotFoundException) {
    false
  }

  /** file:// -> expo-file-system FileProvider'ı ile content://; content:// olduğu gibi kalır. */
  private fun toContentUri(raw: String): Uri {
    val u = Uri.parse(raw)
    if (u.scheme == "content") return u
    val path = if (u.scheme == "file") u.path else raw
    val f = File(path ?: throw CodedException("ERR_BAD_URI", "Geçersiz dosya yolu", null))
    if (!f.isFile) throw CodedException("ERR_NO_FILE", "Dosya bulunamadı", null)
    return FileProvider.getUriForFile(ctx, ctx.packageName + ".FileSystemFileProvider", f)
  }

  private fun mimeOf(uri: Uri): String {
    val ext = (uri.lastPathSegment ?: "").substringAfterLast('.', "").lowercase()
    return android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
  }

  override fun definition() = ModuleDefinition {
    Name("TDeskBridge")
    Events("onBridgeResult")

    Function("isPackageInstalled") { pkg: String -> isInstalled(pkg) }

    // Açık ACTION_SEND: T-Bridge'in "Bilgisayara gönder" paylaşım hedefi. Sonuç T-Bridge'de toast olarak görünür.
    AsyncFunction("sendToBridge") { uri: String ->
      if (!isInstalled(BRIDGE_PKG)) throw CodedException("ERR_NO_BRIDGE", "T-Bridge kurulu değil", null)
      val content = toContentUri(uri)
      val i = Intent(Intent.ACTION_SEND).apply {
        setClassName(BRIDGE_PKG, BRIDGE_SHARE)
        type = mimeOf(content)
        putExtra(Intent.EXTRA_STREAM, content)
        clipData = android.content.ClipData.newRawUri("belge", content)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      (appContext.currentActivity ?: ctx).startActivity(i)
    }

    // Sunum: dosyayı T-Bridge'e verir (present=true); sonuç "onBridgeResult" olayı olarak gelir.
    AsyncFunction("present") { uri: String, promise: Promise ->
      if (!isInstalled(BRIDGE_PKG)) {
        promise.reject("ERR_NO_BRIDGE", "T-Bridge kurulu değil", null)
        return@AsyncFunction
      }
      val content = try {
        toContentUri(uri)
      } catch (e: CodedException) {
        promise.reject(e)
        return@AsyncFunction
      }
      // T-Bridge'in dosyayı okuyabilmesi için bu URI'ye okuma izni (sağlayıcı grantUriPermissions=true).
      ctx.grantUriPermission(BRIDGE_PKG, content, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      withService { s ->
        if (s == null) {
          promise.reject("ERR_BRIDGE_UNAVAILABLE", "T-Bridge'e bağlanılamadı", null)
          return@withService
        }
        val m = Message.obtain(null, WHAT_SEND)
        m.replyTo = reply
        m.data = Bundle().apply {
          putString("uri", content.toString())
          putBoolean("present", true)
        }
        try {
          s.send(m)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("ERR_BRIDGE_SEND", "Gönderilemedi", e)
        }
      }
    }

    // Uzaktan tuş: "next" | "prev" | "end"
    AsyncFunction("presentKey") { key: String, promise: Promise ->
      if (key != "next" && key != "prev" && key != "end") {
        promise.reject("ERR_BAD_KEY", "Geçersiz tuş", null)
        return@AsyncFunction
      }
      withService { s ->
        if (s == null) {
          promise.reject("ERR_BRIDGE_UNAVAILABLE", "T-Bridge'e bağlanılamadı", null)
          return@withService
        }
        val m = Message.obtain(null, WHAT_KEY)
        m.replyTo = reply
        m.data = Bundle().apply { putString("key", key) }
        try {
          s.send(m)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("ERR_BRIDGE_SEND", "Gönderilemedi", e)
        }
      }
    }

    OnDestroy {
      if (service != null || connecting) runCatching { ctx.unbindService(conn) }
      service = null
      connecting = false
    }
  }
}
