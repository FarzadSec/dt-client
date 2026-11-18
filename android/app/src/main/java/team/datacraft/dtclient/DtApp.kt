package team.datacraft.dtclient

import android.app.Application
import team.datacraft.dtclient.data.Repo

class DtApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Repo.init(this)
    }
}
