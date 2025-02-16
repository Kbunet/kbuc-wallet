package io.bluewallet.bluewallet

import android.content.Intent
import android.content.pm.ActivityInfo
import android.os.Bundle
import android.util.Log
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled

class MainActivity : ReactActivity() {

    /**
     * Returns the name of the main component registered from JavaScript.
     * This is used to schedule rendering of the component.
     */
    override fun getMainComponentName(): String {
        return "BlueWallet"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(null)
        if (resources.getBoolean(R.bool.portrait_only)) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        
        // Log the intent data
        intent?.let {
            logIntent(it)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Log the new intent data
        logIntent(intent)
    }

    private fun logIntent(intent: Intent) {
        Log.d("BlueWallet", "Received intent: action=${intent.action}")
        Log.d("BlueWallet", "Data: ${intent.data}")
        Log.d("BlueWallet", "Scheme: ${intent.data?.scheme}")
        Log.d("BlueWallet", "Host: ${intent.data?.host}")
        Log.d("BlueWallet", "Path: ${intent.data?.path}")
        Log.d("BlueWallet", "Query: ${intent.data?.query}")
        
        // Forward the URL to React Native
        val url = intent.data?.toString()
        if (url != null) {
            Log.d("BlueWallet", "Forwarding URL to React Native: $url")
            reactInstanceManager.currentReactContext
                ?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit("url", url)
        }
    }

    /**
     * Returns the instance of the [ReactActivityDelegate]. Here we use a util class [DefaultReactActivityDelegate]
     * which allows you to easily enable Fabric and Concurrent React (aka React 18) with two boolean flags.
     */
    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
