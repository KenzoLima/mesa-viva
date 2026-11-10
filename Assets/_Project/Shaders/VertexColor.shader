// Cor lisa multiplicada pela cor do vértice (URP, unlit, transparente, dois lados).
// Usado nas linhas douradas da área de jogo (o LineRenderer manda a cor e o alfa por vértice,
// e é assim que o TableAreaVisualizer faz o fade) e na alça de rotação.
Shader "MtgAr/VertexColor"
{
    Properties
    {
        _Color ("Cor", Color) = (1, 1, 1, 1)
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "Queue" = "Transparent" "RenderPipeline" = "UniversalPipeline" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; half4 color : COLOR; };
            struct Varyings { float4 positionCS : SV_POSITION; half4 color : COLOR; };

            Varyings vert (Attributes input)
            {
                Varyings o;
                o.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                o.color = input.color * _Color;
                return o;
            }

            half4 frag (Varyings i) : SV_Target
            {
                return i.color;
            }
            ENDHLSL
        }
    }
}
