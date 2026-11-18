package team.datacraft.dtclient

import org.junit.Assert.assertEquals
import org.junit.Test
import team.datacraft.dtclient.ui.Strings

class StringsTest {
    // A key in one language only shows English, or the bare key, to the other.
    @Test
    fun everyWordHasBothLanguages() {
        assertEquals(emptySet<String>(), Strings.missing())
    }
}
