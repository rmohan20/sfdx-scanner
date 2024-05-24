package com.salesforce.cli;

import com.salesforce.config.SfgeConfigTestProvider;
import com.salesforce.config.TestSfgeConfig;
import org.hamcrest.MatcherAssert;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

public class CacheCreatorTest {

    private static final String DUMMY_CACHE_DIR = ".test-sfge-cache";
    private static final String DUMMY_FILE_NAME = "myFileToEntriesDummy.json";
    @Mock CacheCreator.Dependencies dependencies;

    AutoCloseable openMocks;

    @BeforeEach
    void setUp() {
        openMocks = MockitoAnnotations.openMocks(this);
        SfgeConfigTestProvider.set(new TestSfgeConfig() {
            @Override
            public String getCacheDir() {
                return DUMMY_CACHE_DIR;
            }

            @Override
            public String getFilesToEntriesCacheData() {
                return DUMMY_FILE_NAME;
            }
        });
    }

    @AfterEach
    void tearDown() throws Exception {
        openMocks.close();
        SfgeConfigTestProvider.remove();
    }

    @Test
    public void testFilesToEntriesDataCreationForFileCreation() throws IOException {
        Result result = new Result();
        CacheCreator cacheCreator = new CacheCreator(dependencies);
        cacheCreator.create(result);

        final ArgumentCaptor<String> fileNameCaptor = ArgumentCaptor.forClass(String.class);
        final ArgumentCaptor<String> dataCaptor = ArgumentCaptor.forClass(String.class);
        verify(dependencies, times(1)).writeFile(fileNameCaptor.capture(), dataCaptor.capture());

        String actualFilename = fileNameCaptor.getValue();
        MatcherAssert.assertThat(actualFilename, Matchers.containsString(DUMMY_CACHE_DIR));
        MatcherAssert.assertThat(actualFilename, Matchers.containsString(DUMMY_FILE_NAME));

    }

    @Test
    public void testIOExceptionDoesNotDisrupt() throws IOException {
        doThrow(new IOException("dummy exception")).when(dependencies).writeFile(anyString(), anyString());

        Result result = new Result();
        CacheCreator cacheCreator = new CacheCreator(dependencies);

        assertDoesNotThrow(() -> cacheCreator.create(result));
    }
}